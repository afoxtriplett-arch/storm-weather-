import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  AlertSeverity,
  AlertThreshold,
  CurrentWeather,
  DailyPoint,
  GeoJsonPolygonGeometry,
  HourlyPoint,
  PushLogEntry,
  RadarFrame,
  RadarResponse,
  StormAlert,
  WatchedZone,
  WsServerMessage,
} from './src/types/weather.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const GMP_SOLUTION_HEADER = 'gmp_mcp_codeassist_v1_aistudio';

function getMapsApiKey(): string {
  return process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
}

function degToCardinal(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(((deg % 360) / 22.5)) % 16];
}

function wmoToCondition(code: number, isDay = true): { text: string; type: string } {
  if (code === 0) return { text: isDay ? 'Clear Sky' : 'Clear Night', type: 'CLEAR' };
  if (code === 1 || code === 2) return { text: 'Partly Cloudy', type: 'PARTLY_CLOUDY' };
  if (code === 3) return { text: 'Overcast', type: 'CLOUDY' };
  if (code === 45 || code === 48) return { text: 'Fog', type: 'FOG' };
  if (code >= 51 && code <= 57) return { text: 'Drizzle', type: 'LIGHT_RAIN' };
  if (code >= 61 && code <= 65) return { text: code === 65 ? 'Heavy Rain' : 'Rain', type: 'RAIN' };
  if (code >= 66 && code <= 67) return { text: 'Freezing Rain', type: 'FREEZING_RAIN' };
  if (code >= 71 && code <= 77) return { text: 'Snow', type: 'SNOW' };
  if (code >= 80 && code <= 82) return { text: 'Rain Showers', type: 'RAIN_SHOWERS' };
  if (code >= 85 && code <= 86) return { text: 'Snow Showers', type: 'SNOW_SHOWERS' };
  if (code === 95) return { text: 'Thunderstorm', type: 'THUNDERSTORM' };
  if (code === 96 || code === 99) return { text: 'Severe Thunderstorm with Hail', type: 'SEVERE_THUNDERSTORM' };
  return { text: 'Variable Conditions', type: 'CLOUDY' };
}

function computePolygonCentroid(geometry: GeoJsonPolygonGeometry | null): { lat: number; lng: number } | null {
  if (!geometry || !Array.isArray(geometry.coordinates)) return null;
  let ring: number[][] = [];
  if (geometry.type === 'Polygon') {
    const coords = geometry.coordinates as number[][][];
    if (Array.isArray(coords[0])) ring = coords[0];
  } else if (geometry.type === 'MultiPolygon') {
    const coords = geometry.coordinates as number[][][][];
    if (Array.isArray(coords[0]?.[0])) ring = coords[0][0];
  }
  if (ring.length === 0) return null;
  let sumLng = 0;
  let sumLat = 0;
  let count = 0;
  for (const pt of ring) {
    if (Array.isArray(pt) && typeof pt[0] === 'number' && typeof pt[1] === 'number') {
      sumLng += pt[0];
      sumLat += pt[1];
      count += 1;
    }
  }
  if (count === 0) return null;
  return { lat: Number((sumLat / count).toFixed(4)), lng: Number((sumLng / count).toFixed(4)) };
}

function pointInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function isPointNearAlert(lat: number, lng: number, alert: StormAlert): boolean {
  if (alert.polygon && Array.isArray(alert.polygon.coordinates)) {
    if (alert.polygon.type === 'Polygon') {
      const rings = alert.polygon.coordinates as number[][][];
      if (rings[0] && pointInRing(lat, lng, rings[0])) return true;
    } else if (alert.polygon.type === 'MultiPolygon') {
      const polys = alert.polygon.coordinates as number[][][][];
      for (const poly of polys) {
        if (poly[0] && pointInRing(lat, lng, poly[0])) return true;
      }
    }
  }
  if (alert.centroid) {
    const dLat = alert.centroid.lat - lat;
    const dLng = alert.centroid.lng - lng;
    const approxDistDeg = Math.sqrt(dLat * dLat + dLng * dLng);
    if (approxDistDeg <= 0.85) return true;
  }
  return false;
}

function severityRank(s: AlertSeverity): number {
  switch (s) {
    case 'EXTREME': return 4;
    case 'SEVERE': return 3;
    case 'MODERATE': return 2;
    case 'MINOR': return 1;
    default: return 0;
  }
}

function matchesThreshold(severity: AlertSeverity, threshold: AlertThreshold): boolean {
  if (threshold === 'ALL') return true;
  if (threshold === 'MODERATE') return severityRank(severity) >= 2;
  if (threshold === 'SEVERE') return severityRank(severity) >= 3;
  return severityRank(severity) >= 4;
}

// ---------- In-Memory Cache & Authoritative Server State ----------

let radarCache: { expiresAt: number; data: RadarResponse } | null = null;
let nwsAlertsCache: { expiresAt: number; alerts: StormAlert[] } | null = null;

const watchedZones: WatchedZone[] = [
  {
    id: 'zone-okc',
    name: 'Oklahoma City, OK',
    lat: 35.4676,
    lng: -97.5164,
    minSeverity: 'SEVERE',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'zone-mia',
    name: 'Miami, FL',
    lat: 25.7617,
    lng: -80.1918,
    minSeverity: 'SEVERE',
    createdAt: new Date().toISOString(),
  },
];

const seenAlertKeys = new Set<string>();
const pushLog: PushLogEntry[] = [];

// ---------- Upstream Data Fetchers ----------

async function fetchRainViewerFrames(): Promise<RadarResponse> {
  if (radarCache && Date.now() < radarCache.expiresAt) {
    return radarCache.data;
  }
  const resp = await fetch('https://api.rainviewer.com/public/weather-maps.json');
  if (!resp.ok) {
    throw new Error(`RainViewer API error: ${resp.status}`);
  }
  const json = (await resp.json()) as {
    host: string;
    generated: number;
    radar?: {
      past?: Array<{ time: number; path: string }>;
      nowcast?: Array<{ time: number; path: string }>;
    };
    satellite?: {
      infrared?: Array<{ time: number; path: string }>;
    };
  };

  const radarFrames: RadarFrame[] = [
    ...(json.radar?.past || []).map((f) => ({ ...f, type: 'past' as const })),
    ...(json.radar?.nowcast || []).map((f) => ({ ...f, type: 'nowcast' as const })),
  ];
  const satelliteFrames: RadarFrame[] = (json.satellite?.infrared || []).map((f) => ({
    ...f,
    type: 'satellite' as const,
  }));

  const data: RadarResponse = {
    host: json.host || 'https://tilecache.rainviewer.com',
    generated: json.generated || Math.floor(Date.now() / 1000),
    radarFrames,
    satelliteFrames,
  };
  radarCache = { expiresAt: Date.now() + 90_000, data };
  return data;
}

async function fetchNwsActiveAlerts(): Promise<StormAlert[]> {
  if (nwsAlertsCache && Date.now() < nwsAlertsCache.expiresAt) {
    return nwsAlertsCache.alerts;
  }

  try {
    const resp = await fetch(
      'https://api.weather.gov/alerts/active?status=actual&message_type=alert&severity=Extreme,Severe,Moderate',
      {
        headers: {
          'User-Agent': 'StormWatchRadarApp/1.0 (contact@stormwatch.local)',
          Accept: 'application/geo+json',
        },
      }
    );
    if (!resp.ok) {
      throw new Error(`NWS API error: ${resp.status}`);
    }
    const geo = (await resp.json()) as {
      features?: Array<{
        id: string;
        geometry: GeoJsonPolygonGeometry | null;
        properties: {
          id?: string;
          event?: string;
          headline?: string;
          areaDesc?: string;
          severity?: string;
          certainty?: string;
          urgency?: string;
          description?: string;
          instruction?: string | null;
          effective?: string;
          onset?: string;
          expires?: string;
          ends?: string;
          senderName?: string;
        };
      }>;
    };

    const alerts: StormAlert[] = (geo.features || [])
      .slice(0, 120)
      .map((f) => {
        const p = f.properties;
        const rawSev = (p.severity || 'UNKNOWN').toUpperCase();
        const severity: AlertSeverity =
          rawSev === 'EXTREME' || rawSev === 'SEVERE' || rawSev === 'MODERATE' || rawSev === 'MINOR'
            ? rawSev
            : 'UNKNOWN';
        const geometry = f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
          ? f.geometry
          : null;

        return {
          id: f.id || p.id || `nws-${Math.random().toString(36).slice(2)}`,
          title: p.event || p.headline || 'Weather Alert',
          eventType: (p.event || 'WEATHER_ALERT').toUpperCase().replace(/\s+/g, '_'),
          areaName: p.areaDesc || 'Affected Region',
          severity,
          certainty: (p.certainty || 'UNKNOWN').toUpperCase(),
          urgency: (p.urgency || 'UNKNOWN').toUpperCase(),
          description: p.description || p.headline || 'Active weather advisory issued by NWS.',
          instructions: p.instruction ? [p.instruction] : [],
          safetyRecommendations: [],
          startTime: p.onset || p.effective || new Date().toISOString(),
          expirationTime: p.ends || p.expires || null,
          polygon: geometry,
          centroid: computePolygonCentroid(geometry),
          sourceName: p.senderName || 'National Weather Service',
          sourceUri: 'https://www.weather.gov/',
        };
      })
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

    nwsAlertsCache = { expiresAt: Date.now() + 45_000, alerts };
    return alerts;
  } catch (err) {
    console.warn('NWS alerts fetch warning:', err instanceof Error ? err.message : err);
    return nwsAlertsCache?.alerts || [];
  }
}

async function fetchGoogleAlertsForPoint(
  lat: number,
  lng: number
): Promise<{ alerts: StormAlert[]; quotaExceeded: boolean }> {
  const apiKey = getMapsApiKey();
  if (!apiKey) return { alerts: [], quotaExceeded: false };

  try {
    const url = new URL('https://weather.googleapis.com/v1/publicAlerts:lookup');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('location.latitude', String(lat));
    url.searchParams.set('location.longitude', String(lng));
    url.searchParams.set('languageCode', 'en');

    const resp = await fetch(url.toString(), {
      headers: { 'X-Goog-Maps-Solution-ID': GMP_SOLUTION_HEADER },
    });

    if (resp.status === 429) {
      return { alerts: [], quotaExceeded: true };
    }
    if (!resp.ok) {
      const bodyText = await resp.text();
      if (bodyText.includes('RESOURCE_EXHAUSTED')) {
        return { alerts: [], quotaExceeded: true };
      }
      return { alerts: [], quotaExceeded: false };
    }

    const data = (await resp.json()) as {
      weatherAlerts?: Array<{
        alertId: string;
        alertTitle?: { text?: string };
        eventType?: string;
        areaName?: string;
        polygon?: string;
        description?: string;
        severity?: string;
        certainty?: string;
        urgency?: string;
        instruction?: string[];
        safetyRecommendations?: Array<{ directive: string; subtext?: string }>;
        startTime?: string;
        expirationTime?: string | null;
        dataSource?: { name?: string; authorityUri?: string };
      }>;
    };

    const alerts: StormAlert[] = (data.weatherAlerts || []).map((a) => {
      let parsedPoly: GeoJsonPolygonGeometry | null = null;
      if (a.polygon) {
        try {
          const g = JSON.parse(a.polygon) as GeoJsonPolygonGeometry;
          if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
            parsedPoly = g;
          }
        } catch {
          parsedPoly = null;
        }
      }
      const sev = (a.severity || 'UNKNOWN').toUpperCase();
      const severity: AlertSeverity =
        sev === 'EXTREME' || sev === 'SEVERE' || sev === 'MODERATE' || sev === 'MINOR' ? sev : 'UNKNOWN';

      return {
        id: a.alertId,
        title: a.alertTitle?.text || a.eventType || 'Weather Alert',
        eventType: a.eventType || 'WEATHER_ALERT',
        areaName: a.areaName || 'Local Area',
        severity,
        certainty: a.certainty || 'UNKNOWN',
        urgency: a.urgency || 'UNKNOWN',
        description: a.description || '',
        instructions: a.instruction || [],
        safetyRecommendations: a.safetyRecommendations || [],
        startTime: a.startTime || new Date().toISOString(),
        expirationTime: a.expirationTime || null,
        polygon: parsedPoly,
        centroid: computePolygonCentroid(parsedPoly) || { lat, lng },
        sourceName: a.dataSource?.name || 'Meteorological Authority',
        sourceUri: a.dataSource?.authorityUri || 'https://www.weather.gov/',
        isLocal: true,
      };
    });

    return { alerts, quotaExceeded: false };
  } catch {
    return { alerts: [], quotaExceeded: false };
  }
}

async function fetchGoogleWeatherBundle(
  lat: number,
  lng: number
): Promise<{
  current: CurrentWeather | null;
  hourly: HourlyPoint[];
  daily: DailyPoint[];
  quotaExceeded: boolean;
}> {
  const apiKey = getMapsApiKey();
  if (!apiKey) {
    return { current: null, hourly: [], daily: [], quotaExceeded: false };
  }

  try {
    const currUrl = new URL('https://weather.googleapis.com/v1/currentConditions:lookup');
    currUrl.searchParams.set('key', apiKey);
    currUrl.searchParams.set('location.latitude', String(lat));
    currUrl.searchParams.set('location.longitude', String(lng));

    const hourUrl = new URL('https://weather.googleapis.com/v1/forecast/hours:lookup');
    hourUrl.searchParams.set('key', apiKey);
    hourUrl.searchParams.set('location.latitude', String(lat));
    hourUrl.searchParams.set('location.longitude', String(lng));
    hourUrl.searchParams.set('hours', '24');
    hourUrl.searchParams.set('pageSize', '24');

    const dayUrl = new URL('https://weather.googleapis.com/v1/forecast/days:lookup');
    dayUrl.searchParams.set('key', apiKey);
    dayUrl.searchParams.set('location.latitude', String(lat));
    dayUrl.searchParams.set('location.longitude', String(lng));
    dayUrl.searchParams.set('days', '7');
    dayUrl.searchParams.set('pageSize', '7');

    const headers = { 'X-Goog-Maps-Solution-ID': GMP_SOLUTION_HEADER };
    const [currRes, hourRes, dayRes] = await Promise.all([
      fetch(currUrl.toString(), { headers }),
      fetch(hourUrl.toString(), { headers }),
      fetch(dayUrl.toString(), { headers }),
    ]);

    if (currRes.status === 429 || hourRes.status === 429 || dayRes.status === 429) {
      return { current: null, hourly: [], daily: [], quotaExceeded: true };
    }

    if (!currRes.ok) {
      const text = await currRes.text();
      return {
        current: null,
        hourly: [],
        daily: [],
        quotaExceeded: text.includes('RESOURCE_EXHAUSTED'),
      };
    }

    const curr = (await currRes.json()) as any;
    const hourData = hourRes.ok ? ((await hourRes.json()) as any) : { forecastHours: [] };
    const dayData = dayRes.ok ? ((await dayRes.json()) as any) : { forecastDays: [] };

    const current: CurrentWeather = {
      temperatureC: curr.temperature?.degrees ?? 0,
      feelsLikeC: curr.feelsLikeTemperature?.degrees ?? curr.temperature?.degrees ?? 0,
      dewPointC: curr.dewPoint?.degrees ?? 0,
      humidity: curr.relativeHumidity ?? 0,
      uvIndex: curr.uvIndex ?? 0,
      cloudCover: curr.cloudCover ?? 0,
      pressureMb: curr.airPressure?.meanSeaLevelMillibars ?? 1013,
      visibilityKm: curr.visibility?.distance ?? 16,
      windSpeedKmh: curr.wind?.speed?.value ?? 0,
      windGustKmh: curr.wind?.gust?.value ?? curr.wind?.speed?.value ?? 0,
      windDirectionDeg: curr.wind?.direction?.degrees ?? 0,
      windCardinal: degToCardinal(curr.wind?.direction?.degrees ?? 0),
      precipProbPercent: curr.precipitation?.probability?.percent ?? 0,
      precipMm: curr.precipitation?.qpf?.quantity ?? 0,
      thunderstormProbPercent: curr.thunderstormProbability ?? 0,
      conditionText: curr.weatherCondition?.description?.text ?? 'Clear',
      conditionType: curr.weatherCondition?.type ?? 'CLEAR',
      isDaytime: curr.isDaytime ?? true,
      observedAt: curr.currentTime ?? new Date().toISOString(),
      timeZone: curr.timeZone?.id ?? 'UTC',
      source: 'Google Weather API',
    };

    const hourly: HourlyPoint[] = (hourData.forecastHours || []).slice(0, 24).map((h: any) => {
      const hr = h.displayDateTime?.hours;
      const hourLabel =
        typeof hr === 'number'
          ? `${String(hr).padStart(2, '0')}:00`
          : new Date(h.interval?.startTime || Date.now()).toISOString().slice(11, 16);
      return {
        time: h.interval?.startTime || new Date().toISOString(),
        hourLabel,
        tempC: h.temperature?.degrees ?? 0,
        feelsLikeC: h.feelsLikeTemperature?.degrees ?? 0,
        precipProb: h.precipitation?.probability?.percent ?? 0,
        precipMm: h.precipitation?.qpf?.quantity ?? 0,
        thunderstormProb: h.thunderstormProbability ?? 0,
        windSpeedKmh: h.wind?.speed?.value ?? 0,
        windGustKmh: h.wind?.gust?.value ?? h.wind?.speed?.value ?? 0,
        pressureMb: h.airPressure?.meanSeaLevelMillibars ?? 1013,
        conditionText: h.weatherCondition?.description?.text ?? 'Clear',
        conditionType: h.weatherCondition?.type ?? 'CLEAR',
      };
    });

    const daily: DailyPoint[] = (dayData.forecastDays || []).slice(0, 7).map((d: any) => {
      const dateStr = d.displayDate
        ? `${d.displayDate.year}-${String(d.displayDate.month).padStart(2, '0')}-${String(d.displayDate.day).padStart(2, '0')}`
        : (d.interval?.startTime || '').slice(0, 10);
      const dt = new Date(`${dateStr}T12:00:00Z`);
      const dayLabel = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

      return {
        date: dateStr,
        dayLabel,
        maxTempC: d.maxTemperature?.degrees ?? 0,
        minTempC: d.minTemperature?.degrees ?? 0,
        dayCondition: d.daytimeForecast?.weatherCondition?.description?.text ?? 'Partly Cloudy',
        nightCondition: d.nighttimeForecast?.weatherCondition?.description?.text ?? 'Clear',
        precipProb: Math.max(
          d.daytimeForecast?.precipitation?.probability?.percent ?? 0,
          d.nighttimeForecast?.precipitation?.probability?.percent ?? 0
        ),
        precipMm:
          (d.daytimeForecast?.precipitation?.qpf?.quantity ?? 0) +
          (d.nighttimeForecast?.precipitation?.qpf?.quantity ?? 0),
        thunderstormProb: Math.max(
          d.daytimeForecast?.thunderstormProbability ?? 0,
          d.nighttimeForecast?.thunderstormProbability ?? 0
        ),
        maxWindKmh: Math.max(
          d.daytimeForecast?.wind?.speed?.value ?? 0,
          d.nighttimeForecast?.wind?.speed?.value ?? 0
        ),
        maxGustKmh: Math.max(
          d.daytimeForecast?.wind?.gust?.value ?? 0,
          d.nighttimeForecast?.wind?.gust?.value ?? 0
        ),
        sunrise: d.sunEvents?.sunriseTime || '',
        sunset: d.sunEvents?.sunsetTime || '',
      };
    });

    return { current, hourly, daily, quotaExceeded: false };
  } catch {
    return { current: null, hourly: [], daily: [], quotaExceeded: false };
  }
}

async function fetchOpenMeteoBundle(lat: number, lng: number): Promise<{
  current: CurrentWeather;
  hourly: HourlyPoint[];
  daily: DailyPoint[];
}> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lng));
  url.searchParams.set(
    'current',
    'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m'
  );
  url.searchParams.set(
    'hourly',
    'temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,surface_pressure,wind_speed_10m,wind_gusts_10m,cape'
  );
  url.searchParams.set(
    'daily',
    'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max'
  );
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '7');

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    throw new Error(`Open-Meteo error: ${resp.status}`);
  }
  const data = (await resp.json()) as any;
  const c = data.current || {};
  const cond = wmoToCondition(c.weather_code ?? 0, c.is_day === 1);
  const currentWindDeg = c.wind_direction_10m ?? 0;

  const hTimes: string[] = data.hourly?.time || [];
  const nowMs = Date.now();
  let startIdx = hTimes.findIndex((t) => new Date(t).getTime() >= nowMs - 3600_000);
  if (startIdx < 0) startIdx = 0;

  const hourly: HourlyPoint[] = hTimes.slice(startIdx, startIdx + 24).map((t, offset) => {
    const i = startIdx + offset;
    const wmo = data.hourly.weather_code?.[i] ?? 0;
    const cape = data.hourly.cape?.[i] ?? 0;
    const hCond = wmoToCondition(wmo, true);
    const tProb = wmo >= 95 ? 85 : cape > 1000 ? 45 : cape > 400 ? 20 : 0;
    return {
      time: t,
      hourLabel: t.slice(11, 16),
      tempC: data.hourly.temperature_2m?.[i] ?? 0,
      feelsLikeC: data.hourly.apparent_temperature?.[i] ?? 0,
      precipProb: data.hourly.precipitation_probability?.[i] ?? 0,
      precipMm: data.hourly.precipitation?.[i] ?? 0,
      thunderstormProb: tProb,
      windSpeedKmh: data.hourly.wind_speed_10m?.[i] ?? 0,
      windGustKmh: data.hourly.wind_gusts_10m?.[i] ?? 0,
      pressureMb: Math.round(data.hourly.surface_pressure?.[i] ?? 1013),
      conditionText: hCond.text,
      conditionType: hCond.type,
    };
  });

  const current: CurrentWeather = {
    temperatureC: c.temperature_2m ?? 0,
    feelsLikeC: c.apparent_temperature ?? c.temperature_2m ?? 0,
    dewPointC: Math.round(((c.temperature_2m ?? 15) - (100 - (c.relative_humidity_2m ?? 50)) / 5) * 10) / 10,
    humidity: c.relative_humidity_2m ?? 0,
    uvIndex: c.is_day ? 4 : 0,
    cloudCover: c.cloud_cover ?? 0,
    pressureMb: Math.round((c.surface_pressure ?? 1013) * 10) / 10,
    visibilityKm: c.weather_code >= 45 && c.weather_code <= 48 ? 2 : 16,
    windSpeedKmh: c.wind_speed_10m ?? 0,
    windGustKmh: c.wind_gusts_10m ?? c.wind_speed_10m ?? 0,
    windDirectionDeg: currentWindDeg,
    windCardinal: degToCardinal(currentWindDeg),
    precipProbPercent: hourly[0]?.precipProb ?? 0,
    precipMm: c.precipitation ?? 0,
    thunderstormProbPercent: hourly[0]?.thunderstormProb ?? 0,
    conditionText: cond.text,
    conditionType: cond.type,
    isDaytime: c.is_day === 1,
    observedAt: c.time || new Date().toISOString(),
    timeZone: data.timezone || 'UTC',
    source: 'Open-Meteo',
  };

  const dTimes: string[] = data.daily?.time || [];
  const daily: DailyPoint[] = dTimes.slice(0, 7).map((dateStr, i) => {
    const wmo = data.daily.weather_code?.[i] ?? 0;
    const dCond = wmoToCondition(wmo, true);
    const dt = new Date(`${dateStr}T12:00:00Z`);
    const dayLabel = dt.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });

    return {
      date: dateStr,
      dayLabel,
      maxTempC: data.daily.temperature_2m_max?.[i] ?? 0,
      minTempC: data.daily.temperature_2m_min?.[i] ?? 0,
      dayCondition: dCond.text,
      nightCondition: wmo === 0 ? 'Clear Night' : dCond.text,
      precipProb: data.daily.precipitation_probability_max?.[i] ?? 0,
      precipMm: data.daily.precipitation_sum?.[i] ?? 0,
      thunderstormProb: wmo >= 95 ? 80 : 0,
      maxWindKmh: data.daily.wind_speed_10m_max?.[i] ?? 0,
      maxGustKmh: data.daily.wind_gusts_10m_max?.[i] ?? 0,
      sunrise: data.daily.sunrise?.[i] || '',
      sunset: data.daily.sunset?.[i] || '',
    };
  });

  return { current, hourly, daily };
}

// ---------- Express + HTTP + WebSocket Server ----------

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcastWs(message: WsServerMessage) {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

async function scanWatchedZonesForAlerts() {
  const nationalAlerts = await fetchNwsActiveAlerts();

  for (const zone of watchedZones) {
    const { alerts: gmpLocal } = await fetchGoogleAlertsForPoint(zone.lat, zone.lng);
    const nwsLocal = nationalAlerts.filter((a) => isPointNearAlert(zone.lat, zone.lng, a));
    const combined = [...gmpLocal, ...nwsLocal];

    for (const alert of combined) {
      if (!matchesThreshold(alert.severity, zone.minSeverity)) continue;
      const key = `${zone.id}::${alert.id}`;
      if (seenAlertKeys.has(key)) continue;
      seenAlertKeys.add(key);

      const entry: PushLogEntry = {
        id: `push-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toISOString(),
        title: `${alert.severity}: ${alert.title}`,
        body: `${zone.name} — ${alert.areaName}`,
        severity: alert.severity,
        zoneName: zone.name,
        alertId: alert.id,
        centroid: alert.centroid || { lat: zone.lat, lng: zone.lng },
      };

      pushLog.unshift(entry);
      if (pushLog.length > 40) pushLog.pop();

      broadcastWs({ type: 'alert:push', entry, alert });
    }
  }

  broadcastWs({
    type: 'alerts:heartbeat',
    timestamp: new Date().toISOString(),
    activeCount: nationalAlerts.length,
  });
}

wss.on('connection', async (ws) => {
  const alerts = await fetchNwsActiveAlerts();
  const initMsg: WsServerMessage = {
    type: 'state:init',
    zones: watchedZones,
    pushLog,
    activeCount: alerts.length,
  };
  ws.send(JSON.stringify(initMsg));
});

// Poll authoritative feeds every 30s on server
setInterval(() => {
  void scanWatchedZonesForAlerts();
}, 30_000);

// Initial background seed scan
void scanWatchedZonesForAlerts();

// ---------- API Routes ----------

app.get('/api/radar/frames', async (_req, res) => {
  try {
    const frames = await fetchRainViewerFrames();
    res.json(frames);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to load radar frames' });
  }
});

app.get('/api/weather/bundle', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const name = typeof req.query.name === 'string' && req.query.name ? req.query.name : `${lat.toFixed(2)}, ${lng.toFixed(2)}`;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: 'Valid lat and lng query parameters are required.' });
    return;
  }

  const gmp = await fetchGoogleWeatherBundle(lat, lng);
  if (gmp.current) {
    res.json({
      location: { name, lat, lng },
      current: gmp.current,
      hourly: gmp.hourly,
      daily: gmp.daily,
      quotaExceeded: gmp.quotaExceeded,
    });
    return;
  }

  try {
    const fallback = await fetchOpenMeteoBundle(lat, lng);
    res.json({
      location: { name, lat, lng },
      current: fallback.current,
      hourly: fallback.hourly,
      daily: fallback.daily,
      quotaExceeded: gmp.quotaExceeded,
    });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Weather data unavailable',
      quotaExceeded: gmp.quotaExceeded,
    });
  }
});

app.get('/api/alerts/live', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);

  const [nwsAlerts, gmpResult] = await Promise.all([
    fetchNwsActiveAlerts(),
    Number.isFinite(lat) && Number.isFinite(lng)
      ? fetchGoogleAlertsForPoint(lat, lng)
      : Promise.resolve({ alerts: [], quotaExceeded: false }),
  ]);

  const seenIds = new Set<string>();
  const localAlerts: StormAlert[] = [];

  for (const a of gmpResult.alerts) {
    seenIds.add(a.id);
    localAlerts.push({ ...a, isLocal: true });
  }

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    for (const a of nwsAlerts) {
      if (!seenIds.has(a.id) && isPointNearAlert(lat, lng, a)) {
        seenIds.add(a.id);
        localAlerts.push({ ...a, isLocal: true });
      }
    }
  }

  const regionalAlerts = nwsAlerts.filter((a) => !seenIds.has(a.id));

  res.json({
    localAlerts,
    regionalAlerts,
    totalNationalCount: nwsAlerts.length,
    quotaExceeded: gmpResult.quotaExceeded,
  });
});

app.get('/api/zones', (_req, res) => {
  res.json({ zones: watchedZones, pushLog });
});

app.post('/api/zones', async (req, res) => {
  const { name, lat, lng, minSeverity } = req.body as {
    name?: string;
    lat?: number;
    lng?: number;
    minSeverity?: AlertThreshold;
  };

  if (!name || typeof lat !== 'number' || typeof lng !== 'number') {
    res.status(400).json({ error: 'name, lat, and lng are required.' });
    return;
  }

  const zone: WatchedZone = {
    id: `zone-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim(),
    lat,
    lng,
    minSeverity: minSeverity || 'SEVERE',
    createdAt: new Date().toISOString(),
  };

  watchedZones.push(zone);
  broadcastWs({ type: 'zones:updated', zones: watchedZones });

  // Immediately scan this newly added zone
  void scanWatchedZonesForAlerts();

  res.status(201).json({ zone, zones: watchedZones });
});

app.patch('/api/zones/:id', (req, res) => {
  const { id } = req.params;
  const { minSeverity } = req.body as { minSeverity?: AlertThreshold };
  const target = watchedZones.find((z) => z.id === id);
  if (!target) {
    res.status(404).json({ error: 'Watched zone not found.' });
    return;
  }
  if (minSeverity) {
    target.minSeverity = minSeverity;
  }
  broadcastWs({ type: 'zones:updated', zones: watchedZones });
  res.json({ zone: target, zones: watchedZones });
});

app.delete('/api/zones/:id', (req, res) => {
  const { id } = req.params;
  const idx = watchedZones.findIndex((z) => z.id === id);
  if (idx === -1) {
    res.status(404).json({ error: 'Watched zone not found.' });
    return;
  }
  watchedZones.splice(idx, 1);
  broadcastWs({ type: 'zones:updated', zones: watchedZones });
  res.json({ zones: watchedZones });
});

app.post('/api/alerts/test-push', (req, res) => {
  const { lat, lng, locationName, severity } = req.body as {
    lat?: number;
    lng?: number;
    locationName?: string;
    severity?: AlertSeverity;
  };

  const targetLat = typeof lat === 'number' ? lat : 35.4676;
  const targetLng = typeof lng === 'number' ? lng : -97.5164;
  const targetName = locationName || 'Monitored Radar Sector';
  const alertSev: AlertSeverity = severity || 'SEVERE';

  const testPolygon: GeoJsonPolygonGeometry = {
    type: 'Polygon',
    coordinates: [
      [
        [targetLng - 0.18, targetLat + 0.14],
        [targetLng + 0.22, targetLat + 0.11],
        [targetLng + 0.16, targetLat - 0.15],
        [targetLng - 0.21, targetLat - 0.12],
        [targetLng - 0.18, targetLat + 0.14],
      ],
    ],
  };

  const alert: StormAlert = {
    id: `test-alert-${Date.now()}`,
    title: 'Severe Thunderstorm Warning (Test Broadcast)',
    eventType: 'SEVERE_THUNDERSTORM_WARNING',
    areaName: targetName,
    severity: alertSev,
    certainty: 'OBSERVED',
    urgency: 'IMMEDIATE',
    description: `Test severe storm push notification broadcast via StormWatch WebSocket server for ${targetName}. Verify browser push delivery and radar polygon focus.`,
    instructions: [
      'This is a live system test broadcast verifying real-time WebSocket and browser push notification delivery.',
    ],
    safetyRecommendations: [
      {
        directive: 'Notification channel verified',
        subtext: 'Real NWS and Google Weather alerts for your watched zones will appear identically.',
      },
    ],
    startTime: new Date().toISOString(),
    expirationTime: new Date(Date.now() + 45 * 60_000).toISOString(),
    polygon: testPolygon,
    centroid: { lat: targetLat, lng: targetLng },
    sourceName: 'StormWatch Alert Relay',
    sourceUri: 'https://www.weather.gov/',
    isLocal: true,
    isTest: true,
  };

  const entry: PushLogEntry = {
    id: `push-${Date.now()}`,
    timestamp: new Date().toISOString(),
    title: `${alert.severity}: ${alert.title}`,
    body: `${targetName} — Test push alert delivered over WebSocket`,
    severity: alert.severity,
    zoneName: targetName,
    alertId: alert.id,
    centroid: { lat: targetLat, lng: targetLng },
    isTest: true,
  };

  pushLog.unshift(entry);
  if (pushLog.length > 40) pushLog.pop();

  broadcastWs({ type: 'alert:push', entry, alert });
  res.json({ ok: true, entry, alert });
});

async function startServer() {
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`StormWatch server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();

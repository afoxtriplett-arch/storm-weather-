export type AlertSeverity = 'EXTREME' | 'SEVERE' | 'MODERATE' | 'MINOR' | 'UNKNOWN';
export type AlertThreshold = 'EXTREME' | 'SEVERE' | 'MODERATE' | 'ALL';
export type TemperatureUnit = 'C' | 'F';

export interface WeatherLocation {
  name: string;
  region?: string;
  lat: number;
  lng: number;
}

export interface CurrentWeather {
  temperatureC: number;
  feelsLikeC: number;
  dewPointC: number;
  humidity: number;
  uvIndex: number;
  cloudCover: number;
  pressureMb: number;
  visibilityKm: number;
  windSpeedKmh: number;
  windGustKmh: number;
  windDirectionDeg: number;
  windCardinal: string;
  precipProbPercent: number;
  precipMm: number;
  thunderstormProbPercent: number;
  conditionText: string;
  conditionType: string;
  isDaytime: boolean;
  observedAt: string;
  timeZone: string;
  source: string;
}

export interface HourlyPoint {
  time: string;
  hourLabel: string;
  tempC: number;
  feelsLikeC: number;
  precipProb: number;
  precipMm: number;
  thunderstormProb: number;
  windSpeedKmh: number;
  windGustKmh: number;
  pressureMb: number;
  conditionText: string;
  conditionType: string;
}

export interface DailyPoint {
  date: string;
  dayLabel: string;
  maxTempC: number;
  minTempC: number;
  dayCondition: string;
  nightCondition: string;
  precipProb: number;
  precipMm: number;
  thunderstormProb: number;
  maxWindKmh: number;
  maxGustKmh: number;
  sunrise: string;
  sunset: string;
}

export interface WeatherBundle {
  location: WeatherLocation;
  current: CurrentWeather;
  hourly: HourlyPoint[];
  daily: DailyPoint[];
  quotaExceeded?: boolean;
}

export interface GeoJsonPolygonGeometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: unknown;
}

export interface StormAlert {
  id: string;
  title: string;
  eventType: string;
  areaName: string;
  severity: AlertSeverity;
  certainty: string;
  urgency: string;
  description: string;
  instructions: string[];
  safetyRecommendations: Array<{ directive: string; subtext?: string }>;
  startTime: string;
  expirationTime: string | null;
  polygon: GeoJsonPolygonGeometry | null;
  centroid: { lat: number; lng: number } | null;
  sourceName: string;
  sourceUri: string;
  isLocal?: boolean;
  isTest?: boolean;
}

export interface RadarFrame {
  time: number;
  path: string;
  type: 'past' | 'nowcast' | 'satellite';
}

export interface RadarResponse {
  host: string;
  generated: number;
  radarFrames: RadarFrame[];
  satelliteFrames: RadarFrame[];
}

export interface WatchedZone {
  id: string;
  name: string;
  lat: number;
  lng: number;
  minSeverity: AlertThreshold;
  createdAt: string;
}

export interface PushLogEntry {
  id: string;
  timestamp: string;
  title: string;
  body: string;
  severity: AlertSeverity;
  zoneName: string;
  alertId: string;
  centroid: { lat: number; lng: number } | null;
  isTest?: boolean;
}

export type WsServerMessage =
  | {
      type: 'state:init';
      zones: WatchedZone[];
      pushLog: PushLogEntry[];
      activeCount: number;
    }
  | {
      type: 'zones:updated';
      zones: WatchedZone[];
    }
  | {
      type: 'alert:push';
      entry: PushLogEntry;
      alert: StormAlert;
    }
  | {
      type: 'alerts:heartbeat';
      timestamp: string;
      activeCount: number;
    };

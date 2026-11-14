import { useCallback, useEffect, useMemo, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { AlertTriangle, Bell, Radio, X } from 'lucide-react';
import { LocationSearch } from './components/LocationSearch';
import { RadarMapStage } from './components/RadarMapStage';
import { AlertFeedPanel } from './components/AlertFeedPanel';
import { ForecastPanels } from './components/ForecastPanels';
import { NotificationCenter } from './components/NotificationCenter';
import { usePushNotifications } from './hooks/usePushNotifications';
import { useStormWebSocket } from './hooks/useStormWebSocket';
import type {
  AlertThreshold,
  PushLogEntry,
  RadarResponse,
  StormAlert,
  TemperatureUnit,
  WeatherBundle,
  WeatherLocation,
} from './types/weather';
import { getSeverityStyle } from './utils/formatters';

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

const DEFAULT_LOCATION: WeatherLocation = {
  name: 'Oklahoma City, OK',
  region: 'United States',
  lat: 35.4676,
  lng: -97.5164,
};

export default function App() {
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [unit, setUnit] = useState<TemperatureUnit>('F');
  const [location, setLocation] = useState<WeatherLocation>(DEFAULT_LOCATION);
  const [weather, setWeather] = useState<WeatherBundle | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);

  const [radarData, setRadarData] = useState<RadarResponse | null>(null);
  const [localAlerts, setLocalAlerts] = useState<StormAlert[]>([]);
  const [regionalAlerts, setRegionalAlerts] = useState<StormAlert[]>([]);
  const [selectedAlert, setSelectedAlert] = useState<StormAlert | null>(null);
  const [focusTarget, setFocusTarget] = useState<{
    lat: number;
    lng: number;
    zoom?: number;
    nonce: number;
  } | null>(null);

  const [liveToast, setLiveToast] = useState<{
    entry: PushLogEntry;
    alert: StormAlert;
  } | null>(null);

  // Listen for Case A Google Maps Quota Exhaustion
  useEffect(() => {
    const onQuota = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, []);

  const handleNotificationFocus = useCallback(
    (alertId: string) => {
      const all = [...localAlerts, ...regionalAlerts];
      const match = all.find((a) => a.id === alertId);
      if (match) {
        setSelectedAlert(match);
        if (match.centroid) {
          setFocusTarget({
            lat: match.centroid.lat,
            lng: match.centroid.lng,
            zoom: 8,
            nonce: Date.now(),
          });
        }
      }
      document.getElementById('radar-workspace')?.scrollIntoView({ behavior: 'smooth' });
    },
    [localAlerts, regionalAlerts]
  );

  const {
    permission,
    swReady,
    audioEnabled,
    setAudioEnabled,
    requestPermission,
    dispatchBrowserNotification,
  } = usePushNotifications(handleNotificationFocus);

  const handleIncomingAlertPush = useCallback(
    (entry: PushLogEntry, alert: StormAlert) => {
      setLiveToast({ entry, alert });
      if (alert.isTest) {
        setLocalAlerts((prev) => [alert, ...prev.filter((a) => a.id !== alert.id)]);
        setSelectedAlert(alert);
      }
      void dispatchBrowserNotification(entry.title, entry.body, alert.id, alert.severity);
    },
    [dispatchBrowserNotification]
  );

  const {
    connected: wsConnected,
    zones,
    setZones,
    pushLog,
    nationalAlertCount,
  } = useStormWebSocket({ onAlertPush: handleIncomingAlertPush });

  // Fetch live RainViewer radar frames
  const loadRadar = useCallback(async () => {
    try {
      const resp = await fetch('/api/radar/frames');
      if (resp.ok) {
        const data = (await resp.json()) as RadarResponse;
        setRadarData(data);
      }
    } catch {
      // Keep previous radar frames on transient error
    }
  }, []);

  useEffect(() => {
    void loadRadar();
    const timer = window.setInterval(() => void loadRadar(), 120_000);
    return () => window.clearInterval(timer);
  }, [loadRadar]);

  // Fetch weather & alerts whenever monitored location changes
  const loadLocationWeatherAndAlerts = useCallback(async (loc: WeatherLocation) => {
    setWeatherLoading(true);
    try {
      const [wRes, aRes] = await Promise.all([
        fetch(
          `/api/weather/bundle?lat=${encodeURIComponent(loc.lat)}&lng=${encodeURIComponent(loc.lng)}&name=${encodeURIComponent(loc.name)}`
        ),
        fetch(
          `/api/alerts/live?lat=${encodeURIComponent(loc.lat)}&lng=${encodeURIComponent(loc.lng)}`
        ),
      ]);

      if (wRes.status === 429 || aRes.status === 429) {
        setQuotaExceeded(true);
      }

      if (wRes.ok) {
        const wData = (await wRes.json()) as WeatherBundle;
        if (wData.quotaExceeded) setQuotaExceeded(true);
        setWeather(wData);
      }

      if (aRes.ok) {
        const aData = (await aRes.json()) as {
          localAlerts: StormAlert[];
          regionalAlerts: StormAlert[];
          quotaExceeded?: boolean;
        };
        if (aData.quotaExceeded) setQuotaExceeded(true);
        setLocalAlerts(aData.localAlerts || []);
        setRegionalAlerts(aData.regionalAlerts || []);
        if ((aData.localAlerts || []).length > 0) {
          setSelectedAlert(aData.localAlerts[0]);
        } else if ((aData.regionalAlerts || []).length > 0) {
          setSelectedAlert(aData.regionalAlerts[0]);
        }
      }
    } finally {
      setWeatherLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLocationWeatherAndAlerts(location);
  }, [location, loadLocationWeatherAndAlerts]);

  const allAlerts = useMemo(
    () => [...localAlerts, ...regionalAlerts],
    [localAlerts, regionalAlerts]
  );

  // Top active extreme/severe storm hotspots for quick jumping
  const activeHotspots = useMemo(() => {
    const severe = allAlerts.filter(
      (a) => a.centroid && (a.severity === 'EXTREME' || a.severity === 'SEVERE')
    );
    return severe.slice(0, 4);
  }, [allAlerts]);

  const handleJumpToStorm = useCallback((alert: StormAlert) => {
    setSelectedAlert(alert);
    if (alert.centroid) {
      setFocusTarget({
        lat: alert.centroid.lat,
        lng: alert.centroid.lng,
        zoom: 8,
        nonce: Date.now(),
      });
    }
    document.getElementById('radar-workspace')?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const handleAddZone = useCallback(
    async (loc: WeatherLocation, minSeverity: AlertThreshold) => {
      const resp = await fetch('/api/zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: loc.name,
          lat: loc.lat,
          lng: loc.lng,
          minSeverity,
        }),
      });
      if (resp.ok) {
        const data = (await resp.json()) as { zones: typeof zones };
        setZones(data.zones);
      }
    },
    [setZones]
  );

  const handleUpdateZoneThreshold = useCallback(
    async (id: string, minSeverity: AlertThreshold) => {
      const resp = await fetch(`/api/zones/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minSeverity }),
      });
      if (resp.ok) {
        const data = (await resp.json()) as { zones: typeof zones };
        setZones(data.zones);
      }
    },
    [setZones]
  );

  const handleRemoveZone = useCallback(
    async (id: string) => {
      const resp = await fetch(`/api/zones/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (resp.ok) {
        const data = (await resp.json()) as { zones: typeof zones };
        setZones(data.zones);
      }
    },
    [setZones]
  );

  const handleSendTestPush = useCallback(async () => {
    await fetch('/api/alerts/test-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat: location.lat,
        lng: location.lng,
        locationName: location.name,
        severity: 'SEVERE',
      }),
    });
  }, [location]);

  const handleTopCtaClick = async () => {
    if (permission !== 'granted') {
      await requestPermission();
    }
    document.getElementById('notifications-section')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <APIProvider apiKey={MAPS_API_KEY} language="en" region="US">
      <div className="min-h-screen bg-[#070B12] text-slate-100">
        {/* Mandatory Case A Quota Warning Banner */}
        {quotaExceeded && (
          <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
            <span>
              Google Maps Platform quota reached. If you are the app owner, visit{' '}
              <a
                href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold text-amber-950 hover:text-amber-800"
              >
                maps developer site
              </a>{' '}
              for instructions to update your account.
            </span>
          </div>
        )}

        {/* Top Bar Contract: 3 Zones (Wordmark — 4 Single-line Nav Links — 1 Primary Action) */}
        <header className="border-b border-slate-800/90 bg-[#070B12]/95">
          <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-4 py-3.5 sm:px-6">
            <a
              href="#radar-workspace"
              className="font-display text-lg font-bold tracking-tight text-slate-50 whitespace-nowrap shrink-0"
            >
              StormWatch
            </a>

            <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
              <a
                href="#radar-workspace"
                className="whitespace-nowrap shrink-0 text-slate-100 underline decoration-cyan-400 underline-offset-8"
              >
                Radar Map
              </a>
              <a
                href="#alerts-feed"
                className="whitespace-nowrap shrink-0 transition-colors hover:text-slate-100"
              >
                Active Alerts
              </a>
              <a
                href="#forecast-section"
                className="whitespace-nowrap shrink-0 transition-colors hover:text-slate-100"
              >
                Forecast
              </a>
              <a
                href="#notifications-section"
                className="whitespace-nowrap shrink-0 transition-colors hover:text-slate-100"
              >
                Push Alerts
              </a>
            </nav>

            <div className="shrink-0">
              <button
                type="button"
                onClick={() => void handleTopCtaClick()}
                className="whitespace-nowrap shrink-0 rounded-md bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-cyan-400"
              >
                {permission === 'granted' ? 'Manage Alerts' : 'Enable Push'}
              </button>
            </div>
          </div>
        </header>

        {/* Live Incoming WebSocket Storm Push Banner */}
        {liveToast && (
          <div className="fixed right-4 top-16 z-50 w-full max-w-sm rounded-md border border-amber-500/50 bg-[#0F172A] p-4 shadow-2xl">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                <Bell className="h-4 w-4 shrink-0" />
                <span>Live Storm Alert Push</span>
              </div>
              <button
                type="button"
                onClick={() => setLiveToast(null)}
                aria-label="Dismiss alert notification"
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className={`mt-1.5 text-sm font-semibold ${getSeverityStyle(liveToast.alert.severity).textClass}`}>
              {liveToast.entry.title}
            </div>
            <p className="mt-1 text-xs text-slate-300">{liveToast.entry.body}</p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  handleJumpToStorm(liveToast.alert);
                  setLiveToast(null);
                }}
                className="rounded bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400"
              >
                Focus on Radar
              </button>
              <button
                type="button"
                onClick={() => setLiveToast(null)}
                className="rounded border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Main Operations Console */}
        <main className="mx-auto max-w-[1440px] space-y-6 px-4 py-5 sm:px-6">
          {/* Workspace Context & Active Storm Hotspots Strip */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <span className="flex items-center gap-1.5 font-medium text-slate-200">
                <Radio className={`h-3.5 w-3.5 ${wsConnected ? 'text-emerald-400' : 'text-amber-400'}`} />
                {wsConnected ? 'Real-Time Stream Connected' : 'Connecting Stream'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {nationalAlertCount} active national alerts
              </span>
              {activeHotspots.length > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-400">Active storm cells:</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {activeHotspots.map((spot) => (
                      <button
                        key={spot.id}
                        type="button"
                        onClick={() => handleJumpToStorm(spot)}
                        className="flex items-center gap-1 rounded border border-slate-800 bg-[#0B111B] px-2 py-1 text-[11px] font-medium text-amber-300 transition-colors hover:border-amber-500/50 hover:bg-slate-900"
                      >
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        <span className="max-w-[150px] truncate">{spot.title}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Temperature / Speed Unit Toggle */}
            <div className="flex items-center rounded border border-slate-800 bg-[#0B111B] p-0.5">
              <button
                type="button"
                onClick={() => setUnit('F')}
                className={`whitespace-nowrap rounded px-2.5 py-1 font-mono text-xs font-medium transition-colors ${
                  unit === 'F' ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                °F / mph
              </button>
              <button
                type="button"
                onClick={() => setUnit('C')}
                className={`whitespace-nowrap rounded px-2.5 py-1 font-mono text-xs font-medium transition-colors ${
                  unit === 'C' ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                °C / km/h
              </button>
            </div>
          </div>

          {/* Primary Asymmetric Split Console: Left Telemetry & Alerts + Right Interactive Radar Map */}
          <section
            id="radar-workspace"
            className="grid grid-cols-1 gap-5 lg:h-[680px] lg:grid-cols-12"
          >
            <div id="alerts-feed" className="flex min-h-0 flex-col gap-4 lg:col-span-4">
              <div className="rounded-md border border-slate-800 bg-[#0B111B] p-3.5">
                <LocationSearch
                  currentLocation={location}
                  onSelectLocation={(loc) => {
                    setLocation(loc);
                    setFocusTarget({ lat: loc.lat, lng: loc.lng, zoom: 8, nonce: Date.now() });
                  }}
                  onQuotaExceeded={() => setQuotaExceeded(true)}
                />
              </div>

              <div className="min-h-0 flex-1">
                <AlertFeedPanel
                  current={weather?.current || null}
                  unit={unit}
                  localAlerts={localAlerts}
                  regionalAlerts={regionalAlerts}
                  selectedAlert={selectedAlert}
                  onSelectAlert={setSelectedAlert}
                  onJumpToStorm={handleJumpToStorm}
                  loading={weatherLoading}
                />
              </div>
            </div>

            <div className="min-h-[540px] lg:col-span-8 lg:h-full">
              {MAPS_API_KEY ? (
                <RadarMapStage
                  location={location}
                  radarData={radarData}
                  alerts={allAlerts}
                  selectedAlert={selectedAlert}
                  onSelectAlert={setSelectedAlert}
                  onRefreshRadar={() => void loadRadar()}
                  focusTarget={focusTarget}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center rounded-md border border-slate-800 bg-[#0B111B] p-8 text-center">
                  <h2 className="text-base font-semibold text-slate-100">
                    Google Maps API Key Required
                  </h2>
                  <p className="mt-2 max-w-md text-xs text-slate-400">
                    Configure VITE_GOOGLE_MAPS_API_KEY in your environment to display the interactive storm radar map.
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* 24-Hour Trajectory & 7-Day Extended Outlook */}
          <ForecastPanels
            hourly={weather?.hourly || []}
            daily={weather?.daily || []}
            unit={unit}
            locationName={location.name}
          />

          {/* Real-Time Push Notification Center & Watched Zones */}
          <NotificationCenter
            permission={permission}
            swReady={swReady}
            wsConnected={wsConnected}
            audioEnabled={audioEnabled}
            onToggleAudio={() => setAudioEnabled((a) => !a)}
            onRequestPermission={() => void requestPermission()}
            currentLocation={location}
            zones={zones}
            pushLog={pushLog}
            onAddZone={handleAddZone}
            onUpdateZoneThreshold={handleUpdateZoneThreshold}
            onRemoveZone={handleRemoveZone}
            onSendTestPush={handleSendTestPush}
            onFocusCoordinates={(lat, lng, name) => {
              setLocation({ name, lat, lng });
              setFocusTarget({ lat, lng, zoom: 8, nonce: Date.now() });
              document.getElementById('radar-workspace')?.scrollIntoView({ behavior: 'smooth' });
            }}
          />
        </main>

        {/* Quiet Editorial Footer */}
        <footer className="mt-8 border-t border-slate-800/80 py-6">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-4 text-xs text-slate-500 sm:px-6">
            <span>StormWatch · Live Radar, Forecasts & Severe Weather Alerting</span>
            <span>
              Radar tiles via RainViewer · Severe alerts via{' '}
              <a
                href="https://www.weather.gov/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-400 underline hover:text-slate-200"
              >
                National Weather Service
              </a>{' '}
              & Google Weather API
            </span>
          </div>
        </footer>
      </div>
    </APIProvider>
  );
}

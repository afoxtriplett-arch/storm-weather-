import React, { useState } from 'react';
import {
  Bell,
  BellOff,
  MapPin,
  Plus,
  Send,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  AlertThreshold,
  PushLogEntry,
  WatchedZone,
  WeatherLocation,
} from '../types/weather';
import type { PushPermissionState } from '../hooks/usePushNotifications';
import { formatShortTime, getSeverityStyle } from '../utils/formatters';

interface NotificationCenterProps {
  permission: PushPermissionState;
  swReady: boolean;
  wsConnected: boolean;
  audioEnabled: boolean;
  onToggleAudio: () => void;
  onRequestPermission: () => void;
  currentLocation: WeatherLocation;
  zones: WatchedZone[];
  pushLog: PushLogEntry[];
  onAddZone: (loc: WeatherLocation, threshold: AlertThreshold) => Promise<void>;
  onUpdateZoneThreshold: (id: string, threshold: AlertThreshold) => Promise<void>;
  onRemoveZone: (id: string) => Promise<void>;
  onSendTestPush: () => Promise<void>;
  onFocusCoordinates: (lat: number, lng: number, name: string) => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  permission,
  swReady,
  wsConnected,
  audioEnabled,
  onToggleAudio,
  onRequestPermission,
  currentLocation,
  zones,
  pushLog,
  onAddZone,
  onUpdateZoneThreshold,
  onRemoveZone,
  onSendTestPush,
  onFocusCoordinates,
}) => {
  const [newThreshold, setNewThreshold] = useState<AlertThreshold>('SEVERE');
  const [busy, setBusy] = useState(false);
  const [testSentNotice, setTestSentNotice] = useState<string | null>(null);

  const alreadyWatched = zones.some(
    (z) =>
      Math.abs(z.lat - currentLocation.lat) < 0.15 &&
      Math.abs(z.lng - currentLocation.lng) < 0.15
  );

  const handleAddCurrent = async () => {
    setBusy(true);
    try {
      await onAddZone(currentLocation, newThreshold);
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    setBusy(true);
    try {
      await onSendTestPush();
      setTestSentNotice('Test storm alert broadcast dispatched over WebSocket.');
      window.setTimeout(() => setTestSentNotice(null), 4000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      id="notifications-section"
      className="grid grid-cols-1 gap-6 lg:grid-cols-12"
    >
      {/* Left: Push Channel Configuration & Watched Zones */}
      <div className="rounded-md border border-slate-800 bg-[#0B111B] p-5 lg:col-span-6">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Real-Time Push Alert Subscriptions
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Server-monitored coordinates synced via WebSocket ·{' '}
              <span className={wsConnected ? 'text-emerald-400' : 'text-amber-400'}>
                {wsConnected ? 'Live Stream Connected' : 'Reconnecting'}
              </span>
              {swReady ? ' · Service Worker Active' : ''}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleAudio}
              title={audioEnabled ? 'Mute alert chime' : 'Enable alert chime'}
              className="flex h-9 items-center gap-1.5 rounded border border-slate-800 bg-[#070B12] px-3 text-xs font-medium text-slate-300 transition-colors hover:border-slate-700 hover:text-white"
            >
              {audioEnabled ? <Volume2 className="h-3.5 w-3.5 text-cyan-400" /> : <VolumeX className="h-3.5 w-3.5" />}
              {audioEnabled ? 'Chime On' : 'Chime Off'}
            </button>

            <button
              type="button"
              onClick={onRequestPermission}
              disabled={permission === 'granted' || permission === 'unsupported'}
              className={`flex h-9 items-center gap-1.5 rounded px-3 text-xs font-semibold transition-colors ${
                permission === 'granted'
                  ? 'border border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                  : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400 disabled:opacity-50'
              }`}
            >
              {permission === 'granted' ? (
                <>
                  <Bell className="h-3.5 w-3.5" />
                  Browser Push Enabled
                </>
              ) : permission === 'denied' ? (
                <>
                  <BellOff className="h-3.5 w-3.5" />
                  Notifications Blocked
                </>
              ) : (
                <>
                  <Bell className="h-3.5 w-3.5" />
                  Allow Browser Push
                </>
              )}
            </button>
          </div>
        </div>

        {/* Subscribe Current Location Bar */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded border border-slate-800 bg-[#070B12] p-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-200">
              Monitor Current Radar Location: <span className="text-cyan-300">{currentLocation.name}</span>
            </div>
            <div className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-400">
              {currentLocation.lat.toFixed(3)}, {currentLocation.lng.toFixed(3)}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={newThreshold}
              onChange={(e) => setNewThreshold(e.target.value as AlertThreshold)}
              aria-label="Alert threshold for new watched zone"
              className="h-9 rounded border border-slate-700 bg-[#0B111B] px-2.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="EXTREME">Extreme Only</option>
              <option value="SEVERE">Severe & Extreme</option>
              <option value="MODERATE">Watch & Higher</option>
              <option value="ALL">All Advisories</option>
            </select>

            <button
              type="button"
              onClick={() => void handleAddCurrent()}
              disabled={busy || alreadyWatched}
              className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded border border-cyan-500/40 bg-cyan-500/15 px-3 text-xs font-medium text-cyan-300 transition-colors hover:bg-cyan-500/25 disabled:opacity-45"
            >
              <Plus className="h-3.5 w-3.5" />
              {alreadyWatched ? 'Monitored' : 'Watch Zone'}
            </button>
          </div>
        </div>

        {/* Watched Zones List */}
        <div className="mt-4 divide-y divide-slate-800/80">
          {zones.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400">
              No watched zones configured. Add a location above to receive real-time storm pushes.
            </div>
          ) : (
            zones.map((zone) => (
              <div key={zone.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <button
                  type="button"
                  onClick={() => onFocusCoordinates(zone.lat, zone.lng, zone.name)}
                  className="min-w-0 text-left hover:text-cyan-300"
                >
                  <div className="flex items-center gap-1.5 text-sm font-medium text-slate-100">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                    <span className="truncate">{zone.name}</span>
                  </div>
                  <div className="mt-0.5 pl-5 font-mono text-[11px] tabular-nums text-slate-400">
                    {zone.lat.toFixed(2)}°, {zone.lng.toFixed(2)}°
                  </div>
                </button>

                <div className="flex items-center gap-2">
                  <select
                    value={zone.minSeverity}
                    onChange={(e) =>
                      void onUpdateZoneThreshold(zone.id, e.target.value as AlertThreshold)
                    }
                    aria-label={`Severity threshold for ${zone.name}`}
                    className="h-8 rounded border border-slate-800 bg-[#070B12] px-2 text-xs text-slate-300 focus:border-cyan-500 focus:outline-none"
                  >
                    <option value="EXTREME">Extreme Only</option>
                    <option value="SEVERE">Severe & Extreme</option>
                    <option value="MODERATE">Watch & Higher</option>
                    <option value="ALL">All Advisories</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => void onRemoveZone(zone.id)}
                    aria-label={`Remove watched zone ${zone.name}`}
                    className="flex h-8 w-8 items-center justify-center rounded border border-slate-800 bg-[#070B12] text-slate-400 transition-colors hover:border-rose-500/40 hover:text-rose-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right: Real-Time Push Delivery Log & Verification */}
      <div className="rounded-md border border-slate-800 bg-[#0B111B] p-5 lg:col-span-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Live Push Delivery Feed
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Dispatched automatically when NWS or Google Weather alerts match watched sectors
            </p>
          </div>

          <button
            type="button"
            onClick={() => void handleTest()}
            disabled={busy}
            className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded border border-slate-700 bg-slate-900 px-3 text-xs font-medium text-slate-100 transition-colors hover:border-cyan-500/60 hover:text-cyan-300 disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            Send Test Storm Push
          </button>
        </div>

        {testSentNotice && (
          <div className="mt-3 rounded border border-cyan-500/40 bg-cyan-950/30 px-3 py-2 text-xs text-cyan-200">
            {testSentNotice}
          </div>
        )}

        <div className="mt-3 max-h-72 overflow-y-auto divide-y divide-slate-800/80">
          {pushLog.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">
              Monitoring active feeds. Any severe warning matching your watched zones will appear here immediately, or send a test storm push above to verify delivery.
            </div>
          ) : (
            pushLog.map((item) => {
              const sev = getSeverityStyle(item.severity);
              return (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className={`font-semibold ${sev.textClass}`}>{sev.label}</span>
                      <span className="text-slate-500">·</span>
                      <span className="font-mono tabular-nums text-slate-400">
                        {formatShortTime(item.timestamp)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-sm font-medium text-slate-100">
                      {item.title}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">{item.body}</div>
                  </div>

                  {item.centroid && (
                    <button
                      type="button"
                      onClick={() =>
                        onFocusCoordinates(item.centroid!.lat, item.centroid!.lng, item.zoneName)
                      }
                      className="shrink-0 rounded border border-slate-800 bg-[#070B12] px-2.5 py-1 text-xs text-cyan-400 hover:border-cyan-500/50"
                    >
                      View Radar
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
};

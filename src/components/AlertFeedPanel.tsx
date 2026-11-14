import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  MapPin,
  ShieldAlert,
  Wind,
} from 'lucide-react';
import type {
  AlertSeverity,
  CurrentWeather,
  StormAlert,
  TemperatureUnit,
} from '../types/weather';
import {
  formatPrecip,
  formatShortTime,
  formatTemp,
  formatWind,
  getSeverityStyle,
} from '../utils/formatters';

interface AlertFeedPanelProps {
  current: CurrentWeather | null;
  unit: TemperatureUnit;
  localAlerts: StormAlert[];
  regionalAlerts: StormAlert[];
  selectedAlert: StormAlert | null;
  onSelectAlert: (alert: StormAlert) => void;
  onJumpToStorm: (alert: StormAlert) => void;
  loading: boolean;
}

type SeverityFilter = 'ALL' | 'EXTREME' | 'SEVERE' | 'MODERATE';

export const AlertFeedPanel: React.FC<AlertFeedPanelProps> = ({
  current,
  unit,
  localAlerts,
  regionalAlerts,
  selectedAlert,
  onSelectAlert,
  onJumpToStorm,
  loading,
}) => {
  const [filter, setFilter] = useState<SeverityFilter>('ALL');

  const combinedAlerts = useMemo(() => {
    const all = [...localAlerts, ...regionalAlerts];
    if (filter === 'ALL') return all;
    return all.filter((a) => a.severity === filter);
  }, [localAlerts, regionalAlerts, filter]);

  const counts = useMemo(() => {
    const all = [...localAlerts, ...regionalAlerts];
    return {
      total: all.length,
      extreme: all.filter((a) => a.severity === 'EXTREME').length,
      severe: all.filter((a) => a.severity === 'SEVERE').length,
      moderate: all.filter((a) => a.severity === 'MODERATE').length,
    };
  }, [localAlerts, regionalAlerts]);

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Current Meteorological Telemetry Strip */}
      <div className="rounded-md border border-slate-800 bg-[#0B111B] p-4">
        {current ? (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <div className="font-mono text-3xl font-semibold tabular-nums text-slate-50">
                  {formatTemp(current.temperatureC, unit)}
                </div>
                <div className="mt-0.5 text-sm font-medium text-slate-300">
                  {current.conditionText}
                </div>
              </div>
              <div className="text-right text-xs text-slate-400">
                <div>Feels {formatTemp(current.feelsLikeC, unit)}</div>
                <div className="mt-0.5 font-mono tabular-nums">{current.source}</div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-800/90 pt-3">
              <div>
                <div className="text-[11px] text-slate-400">Wind / Gust</div>
                <div className="mt-0.5 font-mono text-xs font-medium tabular-nums text-slate-100">
                  {formatWind(current.windSpeedKmh, unit)} · {current.windCardinal}
                </div>
                <div className="font-mono text-[11px] tabular-nums text-slate-400">
                  Gust {formatWind(current.windGustKmh, unit)}
                </div>
              </div>

              <div>
                <div className="text-[11px] text-slate-400">Storm / Precip</div>
                <div className="mt-0.5 font-mono text-xs font-medium tabular-nums text-cyan-300">
                  {current.thunderstormProbPercent}% storm
                </div>
                <div className="font-mono text-[11px] tabular-nums text-slate-400">
                  {current.precipProbPercent}% · {formatPrecip(current.precipMm, unit)}
                </div>
              </div>

              <div>
                <div className="text-[11px] text-slate-400">Pressure / RH</div>
                <div className="mt-0.5 font-mono text-xs font-medium tabular-nums text-slate-100">
                  {current.pressureMb} mb
                </div>
                <div className="font-mono text-[11px] tabular-nums text-slate-400">
                  {current.humidity}% humidity
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 py-4 text-xs text-slate-400">
            <Wind className="h-4 w-4 text-cyan-400" />
            {loading ? 'Loading live meteorological telemetry...' : 'Select a location to view live telemetry.'}
          </div>
        )}
      </div>

      {/* Active Storm Alerts Feed */}
      <div className="flex min-h-0 flex-1 flex-col rounded-md border border-slate-800 bg-[#0B111B]">
        <div className="border-b border-slate-800 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-100">Active Storm Alerts</h2>
            <span className="font-mono text-xs tabular-nums text-slate-400">
              {localAlerts.length} local · {regionalAlerts.length} regional
            </span>
          </div>

          {/* Severity Filter Controls */}
          <div className="mt-2.5 grid grid-cols-4 gap-1 rounded border border-slate-800 bg-[#070B12] p-0.5">
            {(
              [
                { id: 'ALL', label: `All (${counts.total})` },
                { id: 'EXTREME', label: `Extreme (${counts.extreme})` },
                { id: 'SEVERE', label: `Severe (${counts.severe})` },
                { id: 'MODERATE', label: `Watch (${counts.moderate})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`truncate rounded px-1.5 py-1.5 text-[11px] font-medium transition-colors ${
                  filter === tab.id
                    ? 'bg-slate-800 text-cyan-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/80">
          {combinedAlerts.length === 0 ? (
            <div className="p-5 text-center text-xs text-slate-400">
              No active {filter === 'ALL' ? '' : `${filter.toLowerCase()} `}storm warnings matching this filter.
            </div>
          ) : (
            combinedAlerts.slice(0, 40).map((alert) => {
              const sev = getSeverityStyle(alert.severity as AlertSeverity);
              const isSelected = selectedAlert?.id === alert.id;
              return (
                <div
                  key={alert.id}
                  onClick={() => onSelectAlert(alert)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectAlert(alert);
                    }
                  }}
                  className={`cursor-pointer p-3.5 transition-colors ${
                    isSelected ? 'bg-slate-800/70' : 'hover:bg-slate-900/70'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      {alert.severity === 'EXTREME' ? (
                        <ShieldAlert className={`h-3.5 w-3.5 shrink-0 ${sev.textClass}`} />
                      ) : (
                        <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${sev.textClass}`} />
                      )}
                      <span className={sev.textClass}>{sev.label}</span>
                      {alert.isLocal && (
                        <span className="text-cyan-300">· Local Sector</span>
                      )}
                    </div>

                    {alert.centroid && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onJumpToStorm(alert);
                        }}
                        className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-cyan-400 hover:text-cyan-300"
                      >
                        <MapPin className="h-3 w-3" />
                        Focus
                      </button>
                    )}
                  </div>

                  <div className="mt-1 text-sm font-semibold text-slate-100">
                    {alert.title}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-slate-400">
                    {alert.areaName}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] tabular-nums text-slate-400">
                    <span>Expires {formatShortTime(alert.expirationTime)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{alert.urgency}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Selected Alert Detail Drawer */}
        {selectedAlert && (
          <div className="max-h-64 overflow-y-auto border-t border-slate-700 bg-[#070B12] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className={`text-xs font-semibold ${getSeverityStyle(selectedAlert.severity).textClass}`}>
                {getSeverityStyle(selectedAlert.severity).label} · {selectedAlert.certainty}
              </span>
              {selectedAlert.centroid && (
                <button
                  type="button"
                  onClick={() => onJumpToStorm(selectedAlert)}
                  className="text-xs font-medium text-cyan-400 hover:text-cyan-300"
                >
                  Inspect on Radar
                </button>
              )}
            </div>

            <h3 className="mt-1 text-sm font-semibold text-slate-100">
              {selectedAlert.title}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-300 whitespace-pre-line">
              {selectedAlert.description}
            </p>

            {selectedAlert.instructions.length > 0 && (
              <div className="mt-2.5 rounded border border-slate-800 bg-[#0B111B] p-2.5">
                <div className="text-[11px] font-semibold text-amber-300">
                  Safety Instructions
                </div>
                {selectedAlert.instructions.map((inst, i) => (
                  <p key={i} className="mt-1 text-xs leading-relaxed text-slate-300">
                    {inst}
                  </p>
                ))}
              </div>
            )}

            {/* Mandatory Weather Alert Source Attribution */}
            <div className="mt-2.5 flex items-center gap-1 text-[11px] text-slate-400">
              <span>Source:</span>
              <a
                href={selectedAlert.sourceUri}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-cyan-400 underline hover:text-cyan-300"
              >
                {selectedAlert.sourceName}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

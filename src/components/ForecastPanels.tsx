import React, { useMemo, useState } from 'react';
import type { DailyPoint, HourlyPoint, TemperatureUnit } from '../types/weather';
import {
  formatPrecip,
  formatShortTime,
  formatTemp,
  formatTempNumber,
  formatWind,
} from '../utils/formatters';

interface ForecastPanelsProps {
  hourly: HourlyPoint[];
  daily: DailyPoint[];
  unit: TemperatureUnit;
  locationName: string;
}

export const ForecastPanels: React.FC<ForecastPanelsProps> = ({
  hourly,
  daily,
  unit,
  locationName,
}) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const chartStats = useMemo(() => {
    if (hourly.length === 0) return null;
    const temps = hourly.map((h) => formatTempNumber(h.tempC, unit));
    const minT = Math.min(...temps);
    const maxT = Math.max(...temps);
    const spanT = Math.max(4, maxT - minT);
    return { temps, minT: minT - 1, maxT: maxT + 1, spanT: spanT + 2 };
  }, [hourly, unit]);

  const weeklyRange = useMemo(() => {
    if (daily.length === 0) return { min: 0, max: 30 };
    const mins = daily.map((d) => formatTempNumber(d.minTempC, unit));
    const maxs = daily.map((d) => formatTempNumber(d.maxTempC, unit));
    return {
      min: Math.min(...mins),
      max: Math.max(...maxs),
    };
  }, [daily, unit]);

  const width = 880;
  const height = 220;
  const padX = 44;
  const padTop = 22;
  const padBottom = 34;
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBottom;

  const activeHour = hoverIndex !== null ? hourly[hoverIndex] : hourly[0];

  return (
    <section id="forecast-section" className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* 24-Hour Storm & Precipitation Trajectory */}
      <div className="rounded-md border border-slate-800 bg-[#0B111B] p-5 lg:col-span-7">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              24-Hour Storm & Precipitation Trajectory
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {locationName} · Hover chart to inspect hourly storm risk, temperature, and gusts
            </p>
          </div>
          {activeHour && (
            <div className="flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums">
              <span className="text-slate-300">{activeHour.hourLabel}</span>
              <span className="text-cyan-300">{formatTemp(activeHour.tempC, unit)}</span>
              <span className="text-sky-400">{activeHour.precipProb}% precip</span>
              <span className="text-amber-400">{activeHour.thunderstormProb}% storm</span>
              <span className="text-slate-300">Gust {formatWind(activeHour.windGustKmh, unit)}</span>
            </div>
          )}
        </div>

        {hourly.length === 0 || !chartStats ? (
          <div className="flex h-56 items-center justify-center text-xs text-slate-400">
            Hourly meteorological series unavailable for this sector.
          </div>
        ) : (
          <div className="mt-4">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="h-56 w-full cursor-crosshair select-none"
              onMouseLeave={() => setHoverIndex(null)}
            >
              {/* Horizontal Grid Lines (0%, 50%, 100% Precip/Storm) */}
              {[0, 50, 100].map((pct) => {
                const y = padTop + plotH - (pct / 100) * plotH;
                return (
                  <g key={pct}>
                    <line
                      x1={padX}
                      x2={width - padX}
                      y1={y}
                      y2={y}
                      stroke="#1E293B"
                      strokeDasharray={pct === 0 ? undefined : '3 3'}
                    />
                    <text
                      x={width - padX + 6}
                      y={y + 4}
                      fill="#64748B"
                      fontSize="10"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {pct}%
                    </text>
                  </g>
                );
              })}

              {/* Left Temperature Y-axis bounds */}
              <text
                x={padX - 6}
                y={padTop + 6}
                textAnchor="end"
                fill="#67E8F9"
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
              >
                {chartStats.maxT}°{unit}
              </text>
              <text
                x={padX - 6}
                y={padTop + plotH}
                textAnchor="end"
                fill="#67E8F9"
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
              >
                {chartStats.minT}°{unit}
              </text>

              {/* Precipitation Probability Bars */}
              {hourly.map((pt, idx) => {
                const xCenter = padX + (idx / Math.max(1, hourly.length - 1)) * plotW;
                const barW = Math.max(8, plotW / hourly.length - 6);
                const barH = (pt.precipProb / 100) * plotH;
                return (
                  <rect
                    key={`bar-${pt.time}`}
                    x={xCenter - barW / 2}
                    y={padTop + plotH - barH}
                    width={barW}
                    height={barH}
                    rx={2}
                    fill={hoverIndex === idx ? 'rgba(56, 189, 248, 0.45)' : 'rgba(56, 189, 248, 0.22)'}
                  />
                );
              })}

              {/* Thunderstorm Probability Curve (Amber Dashed) */}
              <path
                d={hourly
                  .map((pt, idx) => {
                    const x = padX + (idx / Math.max(1, hourly.length - 1)) * plotW;
                    const y = padTop + plotH - (pt.thunderstormProb / 100) * plotH;
                    return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
                  })
                  .join(' ')}
                fill="none"
                stroke="#F59E0B"
                strokeWidth="2"
                strokeDasharray="5 4"
              />

              {/* Temperature Curve (Cyan Solid) */}
              <path
                d={hourly
                  .map((pt, idx) => {
                    const x = padX + (idx / Math.max(1, hourly.length - 1)) * plotW;
                    const tVal = formatTempNumber(pt.tempC, unit);
                    const norm = (tVal - chartStats.minT) / chartStats.spanT;
                    const y = padTop + plotH - norm * plotH;
                    return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
                  })
                  .join(' ')}
                fill="none"
                stroke="#06B6D4"
                strokeWidth="2.5"
              />

              {/* Interactive Hover Crosshair & Hit Targets */}
              {hoverIndex !== null && hourly[hoverIndex] && (
                <line
                  x1={padX + (hoverIndex / Math.max(1, hourly.length - 1)) * plotW}
                  x2={padX + (hoverIndex / Math.max(1, hourly.length - 1)) * plotW}
                  y1={padTop}
                  y2={padTop + plotH}
                  stroke="#94A3B8"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
              )}

              {hourly.map((pt, idx) => {
                const x = padX + (idx / Math.max(1, hourly.length - 1)) * plotW;
                const sliceW = plotW / Math.max(1, hourly.length);
                return (
                  <g key={`hit-${pt.time}`}>
                    {idx % 3 === 0 && (
                      <text
                        x={x}
                        y={height - 10}
                        textAnchor="middle"
                        fill="#94A3B8"
                        fontSize="10"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {pt.hourLabel}
                      </text>
                    )}
                    <rect
                      x={x - sliceW / 2}
                      y={padTop}
                      width={sliceW}
                      height={plotH}
                      fill="transparent"
                      onMouseEnter={() => setHoverIndex(idx)}
                    />
                  </g>
                );
              })}
            </svg>

            <div className="mt-2 flex flex-wrap items-center gap-5 text-xs text-slate-400">
              <span className="flex items-center gap-2">
                <span className="inline-block h-0.5 w-4 bg-cyan-400" />
                Temperature (°{unit})
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-3 rounded-xs bg-sky-400/35" />
                Precipitation Probability (%)
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-amber-400" />
                Thunderstorm Risk (%)
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 7-Day Extended Outlook Table */}
      <div className="rounded-md border border-slate-800 bg-[#0B111B] p-5 lg:col-span-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-slate-100">7-Day Extended Outlook</h2>
          <span className="font-mono text-xs text-slate-400">Precip · Gusts · Range</span>
        </div>

        <div className="mt-3 divide-y divide-slate-800/80">
          {daily.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">
              Extended daily forecast unavailable.
            </div>
          ) : (
            daily.map((day) => {
              const minVal = formatTempNumber(day.minTempC, unit);
              const maxVal = formatTempNumber(day.maxTempC, unit);
              const totalSpan = Math.max(1, weeklyRange.max - weeklyRange.min);
              const leftPct = ((minVal - weeklyRange.min) / totalSpan) * 100;
              const widthPct = Math.max(8, ((maxVal - minVal) / totalSpan) * 100);

              return (
                <div key={day.date} className="grid grid-cols-12 items-center gap-2 py-2.5 text-xs">
                  <div className="col-span-4 min-w-0">
                    <div className="truncate font-medium text-slate-100">{day.dayLabel}</div>
                    <div className="truncate text-[11px] text-slate-400">{day.dayCondition}</div>
                  </div>

                  <div className="col-span-3 font-mono tabular-nums text-slate-300">
                    <div className="text-sky-300">{day.precipProb}% · {formatPrecip(day.precipMm, unit)}</div>
                    <div className="text-[11px] text-slate-400">
                      Gust {formatWind(day.maxGustKmh, unit)}
                    </div>
                  </div>

                  <div className="col-span-5 flex items-center gap-2 font-mono tabular-nums">
                    <span className="w-9 text-right text-slate-400">{minVal}°</span>
                    <div className="relative h-1.5 flex-1 rounded-full bg-slate-800">
                      <div
                        className="absolute top-0 h-1.5 rounded-full bg-gradient-to-r from-sky-400 to-amber-400"
                        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      />
                    </div>
                    <span className="w-9 text-slate-100">{maxVal}°</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {daily[0] && (daily[0].sunrise || daily[0].sunset) && (
          <div className="mt-3 flex items-center justify-between border-t border-slate-800 pt-3 font-mono text-[11px] tabular-nums text-slate-400">
            <span>Today Sunrise {formatShortTime(daily[0].sunrise)}</span>
            <span>Sunset {formatShortTime(daily[0].sunset)}</span>
          </div>
        )}
      </div>
    </section>
  );
};

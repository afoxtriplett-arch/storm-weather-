import type { AlertSeverity, TemperatureUnit } from '../types/weather';

export function formatTemp(tempC: number, unit: TemperatureUnit): string {
  if (unit === 'F') {
    return `${Math.round((tempC * 9) / 5 + 32)}°F`;
  }
  return `${Math.round(tempC)}°C`;
}

export function formatTempNumber(tempC: number, unit: TemperatureUnit): number {
  if (unit === 'F') {
    return Math.round((tempC * 9) / 5 + 32);
  }
  return Math.round(tempC);
}

export function formatWind(kmh: number, unit: TemperatureUnit): string {
  if (unit === 'F') {
    return `${Math.round(kmh * 0.621371)} mph`;
  }
  return `${Math.round(kmh)} km/h`;
}

export function formatPrecip(mm: number, unit: TemperatureUnit): string {
  if (unit === 'F') {
    return `${(mm * 0.0393701).toFixed(2)} in`;
  }
  return `${mm.toFixed(1)} mm`;
}

export function formatShortTime(isoString: string | null): string {
  if (!isoString) return 'Until further notice';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatRadarEpoch(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function getSeverityStyle(severity: AlertSeverity): {
  label: string;
  textClass: string;
  borderClass: string;
  bgClass: string;
  hex: string;
} {
  switch (severity) {
    case 'EXTREME':
      return {
        label: 'Extreme Warning',
        textClass: 'text-rose-400',
        borderClass: 'border-rose-500/40',
        bgClass: 'bg-rose-950/35',
        hex: '#EF4444',
      };
    case 'SEVERE':
      return {
        label: 'Severe Warning',
        textClass: 'text-amber-400',
        borderClass: 'border-amber-500/40',
        bgClass: 'bg-amber-950/30',
        hex: '#F59E0B',
      };
    case 'MODERATE':
      return {
        label: 'Watch / Advisory',
        textClass: 'text-yellow-300',
        borderClass: 'border-yellow-500/35',
        bgClass: 'bg-yellow-950/25',
        hex: '#EAB308',
      };
    default:
      return {
        label: 'Weather Statement',
        textClass: 'text-sky-400',
        borderClass: 'border-sky-500/35',
        bgClass: 'bg-sky-950/25',
        hex: '#38BDF8',
      };
  }
}

import React, { useCallback, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { Crosshair, Loader2, MapPin, Search, X } from 'lucide-react';
import { useAutocompleteSuggestions } from '../hooks/useAutocompleteSuggestions';
import type { WeatherLocation } from '../types/weather';

interface LocationSearchProps {
  currentLocation: WeatherLocation;
  onSelectLocation: (loc: WeatherLocation) => void;
  onQuotaExceeded: () => void;
}

interface FallbackResult {
  id: number;
  name: string;
  admin1?: string;
  country_code?: string;
  latitude: number;
  longitude: number;
}

export const LocationSearch: React.FC<LocationSearchProps> = ({
  currentLocation,
  onSelectLocation,
  onQuotaExceeded,
}) => {
  const placesLib = useMapsLibrary('places');
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [fallbackResults, setFallbackResults] = useState<FallbackResult[]>([]);
  const { suggestions, isLoading, resetSession } = useAutocompleteSuggestions(query);

  const handleSelectSuggestion = useCallback(
    async (suggestion: google.maps.places.AutocompleteSuggestion) => {
      if (!placesLib || !suggestion.placePrediction) return;
      try {
        const place = suggestion.placePrediction.toPlace();
        await place.fetchFields({
          fields: ['displayName', 'formattedAddress', 'location'],
        });
        const loc = place.location;
        if (loc) {
          onSelectLocation({
            name: place.displayName || suggestion.placePrediction.text.text,
            region: place.formattedAddress || undefined,
            lat: loc.lat(),
            lng: loc.lng(),
          });
        }
        setQuery('');
        setIsOpen(false);
        setFallbackResults([]);
        resetSession();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('OVER_QUERY_LIMIT') || msg.includes('429')) {
          onQuotaExceeded();
        }
      }
    },
    [placesLib, onSelectLocation, resetSession, onQuotaExceeded]
  );

  const handleFallbackSearch = useCallback(async (searchText: string) => {
    const trimmed = searchText.trim();
    if (trimmed.length < 2) {
      setFallbackResults([]);
      return;
    }
    try {
      const resp = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(trimmed)}&count=5&language=en&format=json`
      );
      if (resp.ok) {
        const json = (await resp.json()) as { results?: FallbackResult[] };
        setFallbackResults(json.results || []);
      }
    } catch {
      setFallbackResults([]);
    }
  }, []);

  const handleGeolocate = useCallback(() => {
    if (!('geolocation' in navigator)) return;
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoLoading(false);
        onSelectLocation({
          name: 'Current Location',
          region: `${pos.coords.latitude.toFixed(3)}, ${pos.coords.longitude.toFixed(3)}`,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      () => {
        setGeoLoading(false);
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }, [onSelectLocation]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && query.trim().length >= 2) {
      if (suggestions.length > 0) {
        void handleSelectSuggestion(suggestions[0]);
      } else {
        void handleFallbackSearch(query);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onFocus={() => setIsOpen(true)}
            onChange={(e) => {
              const val = e.target.value;
              setQuery(val);
              setIsOpen(true);
              if (val.trim().length >= 3 && suggestions.length === 0) {
                void handleFallbackSearch(val);
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search city, county, or coordinates..."
            aria-label="Search weather location"
            className="h-10 w-full rounded-md border border-slate-800 bg-[#0B111B] pl-9 pr-8 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setFallbackResults([]);
                setIsOpen(false);
              }}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={handleGeolocate}
          disabled={geoLoading}
          title="Use my current location"
          aria-label="Use my current location"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-800 bg-[#0B111B] text-slate-300 transition-colors hover:border-cyan-500/60 hover:text-cyan-400 disabled:opacity-50"
        >
          {geoLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
        <span className="truncate font-medium text-slate-200">{currentLocation.name}</span>
        <span className="ml-2 shrink-0 font-mono tabular-nums text-slate-400">
          {currentLocation.lat.toFixed(2)}°, {currentLocation.lng.toFixed(2)}°
        </span>
      </div>

      {isOpen && query.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-11 z-40 max-h-64 overflow-y-auto rounded-md border border-slate-700 bg-[#0F172A] shadow-xl">
          {isLoading && suggestions.length === 0 && fallbackResults.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />
              Searching locations...
            </div>
          )}

          {suggestions.map((s, idx) => (
            <button
              key={`gmp-${idx}`}
              type="button"
              onClick={() => void handleSelectSuggestion(s)}
              className="flex w-full items-center gap-2.5 border-b border-slate-800/70 px-3 py-2.5 text-left text-sm text-slate-200 transition-colors last:border-b-0 hover:bg-slate-800/70"
            >
              <MapPin className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
              <span className="truncate">{s.placePrediction?.text.text}</span>
            </button>
          ))}

          {suggestions.length === 0 &&
            fallbackResults.map((r) => (
              <button
                key={`fb-${r.id}`}
                type="button"
                onClick={() => {
                  onSelectLocation({
                    name: r.admin1 ? `${r.name}, ${r.admin1}` : r.name,
                    region: r.country_code,
                    lat: r.latitude,
                    lng: r.longitude,
                  });
                  setQuery('');
                  setFallbackResults([]);
                  setIsOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 border-b border-slate-800/70 px-3 py-2.5 text-left text-sm text-slate-200 transition-colors last:border-b-0 hover:bg-slate-800/70"
              >
                <span className="flex items-center gap-2 truncate">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                  <span className="truncate">
                    {r.name}
                    {r.admin1 ? `, ${r.admin1}` : ''}
                    {r.country_code ? ` · ${r.country_code}` : ''}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-slate-400">
                  {r.latitude.toFixed(1)}, {r.longitude.toFixed(1)}
                </span>
              </button>
            ))}

          {!isLoading && suggestions.length === 0 && fallbackResults.length === 0 && (
            <button
              type="button"
              onClick={() => void handleFallbackSearch(query)}
              className="w-full px-3 py-2.5 text-left text-xs text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
            >
              No instant suggestions. Press Enter to geocode "{query}".
            </button>
          )}
        </div>
      )}
    </div>
  );
};

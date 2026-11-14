import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AdvancedMarker,
  Map as GoogleMap,
  useMap,
} from '@vis.gl/react-google-maps';
import {
  ChevronLeft,
  ChevronRight,
  Layers,
  LocateFixed,
  Pause,
  Play,
  Radar,
  RefreshCw,
} from 'lucide-react';
import type { RadarFrame, RadarResponse, StormAlert, WeatherLocation } from '../types/weather';
import { formatRadarEpoch, getSeverityStyle } from '../utils/formatters';

interface RadarMapStageProps {
  location: WeatherLocation;
  radarData: RadarResponse | null;
  alerts: StormAlert[];
  selectedAlert: StormAlert | null;
  onSelectAlert: (alert: StormAlert) => void;
  onRefreshRadar: () => void;
  focusTarget: { lat: number; lng: number; zoom?: number; nonce: number } | null;
}

type LayerMode = 'radar' | 'satellite' | 'none';
type BaseMapType = 'roadmap' | 'satellite' | 'terrain';

export const RadarMapStage: React.FC<RadarMapStageProps> = ({
  location,
  radarData,
  alerts,
  selectedAlert,
  onSelectAlert,
  onRefreshRadar,
  focusTarget,
}) => {
  const map = useMap();

  const [layerMode, setLayerMode] = useState<LayerMode>('radar');
  const [baseMapType, setBaseMapType] = useState<BaseMapType>('roadmap');
  const [showPolygons, setShowPolygons] = useState(true);
  const [radarOpacity, setRadarOpacity] = useState(0.75);
  const [isPlaying, setIsPlaying] = useState(true);
  const [frameIndex, setFrameIndex] = useState(0);

  const activeFrames: RadarFrame[] = useMemo(() => {
    if (!radarData) return [];
    if (layerMode === 'radar') return radarData.radarFrames;
    if (layerMode === 'satellite') return radarData.satelliteFrames;
    return [];
  }, [radarData, layerMode]);

  // Default to the latest observed radar frame when frames load
  useEffect(() => {
    if (activeFrames.length === 0) return;
    const nowcastIdx = activeFrames.findIndex((f) => f.type === 'nowcast');
    const latestPast = nowcastIdx > 0 ? nowcastIdx - 1 : activeFrames.length - 1;
    setFrameIndex(Math.max(0, latestPast));
  }, [activeFrames.length, layerMode]);

  // Animate radar frames smoothly when playing
  useEffect(() => {
    if (!isPlaying || activeFrames.length <= 1 || layerMode === 'none') return;
    const timer = window.setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % activeFrames.length);
    }, 650);
    return () => window.clearInterval(timer);
  }, [isPlaying, activeFrames.length, layerMode]);

  const currentFrame = activeFrames[frameIndex] || null;

  // Pan & zoom map when location or explicit focusTarget changes
  const lastLocationKeyRef = useRef<string>('');
  useEffect(() => {
    if (!map) return;
    const key = `${location.lat.toFixed(4)},${location.lng.toFixed(4)}`;
    if (key !== lastLocationKeyRef.current) {
      lastLocationKeyRef.current = key;
      map.panTo({ lat: location.lat, lng: location.lng });
      const currentZoom = map.getZoom() ?? 5;
      if (currentZoom < 6) {
        map.setZoom(7);
      }
    }
  }, [map, location]);

  useEffect(() => {
    if (!map || !focusTarget) return;
    map.panTo({ lat: focusTarget.lat, lng: focusTarget.lng });
    if (focusTarget.zoom) {
      map.setZoom(focusTarget.zoom);
    }
  }, [map, focusTarget]);

  // Sync base map type
  useEffect(() => {
    if (!map) return;
    map.setMapTypeId(baseMapType);
  }, [map, baseMapType]);

  // Manage RainViewer ImageMapType overlay
  useEffect(() => {
    if (!map || !radarData || !currentFrame || layerMode === 'none') {
      if (map) {
        map.overlayMapTypes.clear();
      }
      return;
    }

    const tileUrlBuilder = (coord: google.maps.Point, zoom: number) => {
      if (zoom > 10 || zoom < 1) return '';
      const maxTile = Math.pow(2, zoom);
      const wrappedX = ((coord.x % maxTile) + maxTile) % maxTile;
      if (coord.y < 0 || coord.y >= maxTile) return '';

      if (layerMode === 'radar') {
        // RainViewer v2 radar tiles: color scheme 2 (Universal Blue), smooth=1, snow=1
        return `${radarData.host}${currentFrame.path}/256/${zoom}/${wrappedX}/${coord.y}/2/1_1.png`;
      }
      // RainViewer infrared satellite tiles: color scheme 0
      return `${radarData.host}${currentFrame.path}/256/${zoom}/${wrappedX}/${coord.y}/0/0_0.png`;
    };

    const imageMapType = new google.maps.ImageMapType({
      getTileUrl: tileUrlBuilder,
      tileSize: new google.maps.Size(256, 256),
      opacity: radarOpacity,
      name: layerMode === 'radar' ? 'Precipitation Radar' : 'Infrared Satellite',
      maxZoom: 12,
      minZoom: 1,
    });

    map.overlayMapTypes.clear();
    map.overlayMapTypes.push(imageMapType);

    return () => {
      map.overlayMapTypes.clear();
    };
  }, [map, radarData, currentFrame, layerMode, radarOpacity]);

  // Manage GeoJSON Severe Storm Alert polygons on map.data
  const alertsByIdRef = useRef<Record<string, StormAlert>>({});
  useEffect(() => {
    const lookup: Record<string, StormAlert> = {};
    for (const a of alerts) {
      lookup[a.id] = a;
    }
    alertsByIdRef.current = lookup;
  }, [alerts]);

  useEffect(() => {
    if (!map) return;

    // Clear existing features
    map.data.forEach((feature) => {
      map.data.remove(feature);
    });

    if (!showPolygons) return;

    const features = alerts
      .filter((a) => a.polygon !== null)
      .map((a) => ({
        type: 'Feature',
        id: a.id,
        geometry: a.polygon,
        properties: {
          alertId: a.id,
          severity: a.severity,
          title: a.title,
        },
      }));

    if (features.length > 0) {
      map.data.addGeoJson({
        type: 'FeatureCollection',
        features,
      });
    }
  }, [map, alerts, showPolygons]);

  useEffect(() => {
    if (!map) return;

    map.data.setStyle((feature) => {
      const alertId = String(feature.getProperty('alertId') || '');
      const severity = (feature.getProperty('severity') || 'UNKNOWN') as StormAlert['severity'];
      const isSelected = selectedAlert?.id === alertId;
      const sevStyle = getSeverityStyle(severity);

      return {
        fillColor: sevStyle.hex,
        fillOpacity: isSelected ? 0.38 : 0.18,
        strokeColor: sevStyle.hex,
        strokeWeight: isSelected ? 3 : 1.5,
        strokeOpacity: isSelected ? 1 : 0.85,
        clickable: true,
        zIndex: isSelected ? 10 : 2,
      };
    });

    const clickListener = map.data.addListener('click', (event: google.maps.Data.MouseEvent) => {
      const alertId = String(event.feature.getProperty('alertId') || '');
      const found = alertsByIdRef.current[alertId];
      if (found) {
        onSelectAlert(found);
      }
    });

    const mouseoverListener = map.data.addListener('mouseover', (event: google.maps.Data.MouseEvent) => {
      map.data.overrideStyle(event.feature, { strokeWeight: 3, fillOpacity: 0.32 });
    });

    const mouseoutListener = map.data.addListener('mouseout', () => {
      map.data.revertStyle();
    });

    return () => {
      clickListener.remove();
      mouseoverListener.remove();
      mouseoutListener.remove();
    };
  }, [map, selectedAlert, onSelectAlert]);

  const handleRecenter = useCallback(() => {
    if (!map) return;
    map.panTo({ lat: location.lat, lng: location.lng });
    map.setZoom(8);
  }, [map, location]);

  // Show centroid markers for top active extreme/severe polygons
  const severeCentroids = useMemo(
    () =>
      alerts
        .filter((a) => a.centroid && (a.severity === 'EXTREME' || a.severity === 'SEVERE'))
        .slice(0, 18),
    [alerts]
  );

  return (
    <div className="relative h-full min-h-[540px] w-full overflow-hidden rounded-md border border-slate-800 bg-[#070B12]">
      <GoogleMap
        defaultCenter={{ lat: location.lat, lng: location.lng }}
        defaultZoom={6}
        mapId="DEMO_MAP_ID"
        colorScheme="DARK"
        gestureHandling="greedy"
        disableDefaultUI={true}
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        style={{ width: '100%', height: '100%' }}
      >
        {/* Monitored Location Target Marker */}
        <AdvancedMarker position={{ lat: location.lat, lng: location.lng }} title={location.name}>
          <div className="flex flex-col items-center">
            <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-cyan-400 bg-slate-950/90 shadow-lg">
              <div className="h-2 w-2 rounded-full bg-cyan-400" />
            </div>
            <span className="mt-1 whitespace-nowrap rounded border border-slate-700 bg-slate-950/90 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-100">
              {location.name.split(',')[0]}
            </span>
          </div>
        </AdvancedMarker>

        {/* Active Extreme / Severe Storm Centroid Pins */}
        {showPolygons &&
          severeCentroids.map((alert) => {
            if (!alert.centroid) return null;
            const style = getSeverityStyle(alert.severity);
            const isSelected = selectedAlert?.id === alert.id;
            return (
              <AdvancedMarker
                key={`marker-${alert.id}`}
                position={alert.centroid}
                onClick={() => onSelectAlert(alert)}
                title={`${alert.severity}: ${alert.title}`}
              >
                <div
                  className={`flex h-5 w-5 items-center justify-center rounded-sm border text-[10px] font-bold transition-transform ${
                    isSelected ? 'scale-125' : 'hover:scale-110'
                  }`}
                  style={{
                    backgroundColor: '#070B12',
                    borderColor: style.hex,
                    color: style.hex,
                  }}
                >
                  !
                </div>
              </AdvancedMarker>
            );
          })}
      </GoogleMap>

      {/* Top-Left HUD Controls: Base Map + Polygons + Recenter */}
      <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-md border border-slate-800 bg-[#0B111B]/95 p-0.5 backdrop-blur">
          {(['roadmap', 'satellite', 'terrain'] as BaseMapType[]).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setBaseMapType(type)}
              className={`whitespace-nowrap rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                baseMapType === type
                  ? 'bg-slate-800 text-cyan-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {type === 'roadmap' ? 'Dark Map' : type}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setShowPolygons((p) => !p)}
          className={`flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-xs font-medium backdrop-blur transition-colors ${
            showPolygons
              ? 'border-amber-500/50 bg-[#0B111B]/95 text-amber-300'
              : 'border-slate-800 bg-[#0B111B]/95 text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
          Alert Polygons
        </button>

        <button
          type="button"
          onClick={handleRecenter}
          title="Recenter on active location"
          className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-800 bg-[#0B111B]/95 px-2.5 py-1.5 text-xs font-medium text-slate-300 backdrop-blur transition-colors hover:border-cyan-500/50 hover:text-cyan-300"
        >
          <LocateFixed className="h-3.5 w-3.5" />
          Recenter
        </button>
      </div>

      {/* Top-Right Radar Reflectivity dBZ Scale Legend */}
      <div className="absolute right-3 top-3 z-10 hidden sm:flex items-center gap-2.5 rounded-md border border-slate-800 bg-[#0B111B]/95 px-3 py-1.5 text-[11px] text-slate-300 backdrop-blur">
        <span className="font-mono text-slate-400">dBZ</span>
        <div className="flex items-center gap-1">
          <span className="h-2.5 w-4 rounded-xs bg-[#22D3EE]" title="Light Rain" />
          <span className="h-2.5 w-4 rounded-xs bg-[#22C55E]" title="Moderate Rain" />
          <span className="h-2.5 w-4 rounded-xs bg-[#FACC15]" title="Heavy Rain" />
          <span className="h-2.5 w-4 rounded-xs bg-[#F97316]" title="Very Heavy" />
          <span className="h-2.5 w-4 rounded-xs bg-[#EF4444]" title="Severe / Hail" />
        </div>
        <span className="text-slate-400">Light to Hail</span>
      </div>

      {/* Bottom Floating Radar Playback & Layer Control Bar */}
      <div className="absolute bottom-3 left-3 right-3 z-10 rounded-md border border-slate-800 bg-[#0B111B]/95 p-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Play / Step / Frame Timestamp */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsPlaying((p) => !p)}
              disabled={layerMode === 'none' || activeFrames.length <= 1}
              aria-label={isPlaying ? 'Pause radar animation' : 'Play radar animation'}
              className="flex h-8 w-8 items-center justify-center rounded border border-slate-700 bg-slate-900 text-cyan-400 transition-colors hover:border-cyan-500/60 hover:bg-slate-800 disabled:opacity-40"
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>

            <button
              type="button"
              onClick={() => {
                setIsPlaying(false);
                setFrameIndex((prev) =>
                  activeFrames.length ? (prev - 1 + activeFrames.length) % activeFrames.length : 0
                );
              }}
              disabled={layerMode === 'none' || activeFrames.length <= 1}
              aria-label="Previous radar frame"
              className="flex h-8 w-8 items-center justify-center rounded border border-slate-800 bg-slate-900 text-slate-300 hover:text-white disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => {
                setIsPlaying(false);
                setFrameIndex((prev) => (activeFrames.length ? (prev + 1) % activeFrames.length : 0));
              }}
              disabled={layerMode === 'none' || activeFrames.length <= 1}
              aria-label="Next radar frame"
              className="flex h-8 w-8 items-center justify-center rounded border border-slate-800 bg-slate-900 text-slate-300 hover:text-white disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>

            <div className="ml-1 flex items-center gap-2">
              <Radar className="h-4 w-4 text-cyan-400" />
              <span className="font-mono text-xs font-semibold tabular-nums text-slate-100">
                {currentFrame ? formatRadarEpoch(currentFrame.time) : '--:--'}
              </span>
              {currentFrame && (
                <span className="text-xs text-slate-400">
                  · {currentFrame.type === 'nowcast' ? 'Forecast' : currentFrame.type === 'satellite' ? 'IR Cloud' : 'Observed'}
                </span>
              )}
            </div>
          </div>

          {/* Layer Mode Switcher + Opacity + Refresh */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded border border-slate-800 bg-slate-950 p-0.5">
              {(
                [
                  { id: 'radar', label: 'Doppler Radar' },
                  { id: 'satellite', label: 'Satellite IR' },
                  { id: 'none', label: 'Off' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setLayerMode(item.id)}
                  className={`whitespace-nowrap rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    layerMode === item.id
                      ? 'bg-cyan-500/20 text-cyan-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <label className="hidden md:flex items-center gap-2 text-xs text-slate-400">
              <span>Opacity</span>
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.05}
                value={radarOpacity}
                onChange={(e) => setRadarOpacity(Number(e.target.value))}
                className="h-1.5 w-20 accent-cyan-400"
              />
            </label>

            <button
              type="button"
              onClick={onRefreshRadar}
              title="Refresh live radar frames"
              aria-label="Refresh live radar frames"
              className="flex h-8 items-center gap-1.5 rounded border border-slate-800 bg-slate-900 px-2.5 text-xs text-slate-300 transition-colors hover:border-slate-700 hover:text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sync</span>
            </button>
          </div>
        </div>

        {/* Scrubber Track */}
        {layerMode !== 'none' && activeFrames.length > 0 && (
          <div className="mt-2.5 flex items-center gap-1.5">
            {activeFrames.map((frame, idx) => {
              const isActive = idx === frameIndex;
              const isNowcast = frame.type === 'nowcast';
              return (
                <button
                  key={frame.time}
                  type="button"
                  onClick={() => {
                    setIsPlaying(false);
                    setFrameIndex(idx);
                  }}
                  title={`${formatRadarEpoch(frame.time)} (${frame.type})`}
                  aria-label={`Radar frame ${formatRadarEpoch(frame.time)}`}
                  className={`h-1.5 flex-1 rounded-xs transition-colors ${
                    isActive
                      ? 'bg-cyan-400'
                      : isNowcast
                      ? 'bg-amber-500/35 hover:bg-amber-400/60'
                      : 'bg-slate-700 hover:bg-slate-600'
                  }`}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

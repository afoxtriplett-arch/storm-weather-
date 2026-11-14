import { useEffect, useRef, useState } from 'react';
import type { PushLogEntry, StormAlert, WatchedZone, WsServerMessage } from '../types/weather';

interface UseStormWebSocketOptions {
  onAlertPush: (entry: PushLogEntry, alert: StormAlert) => void;
}

export function useStormWebSocket({ onAlertPush }: UseStormWebSocketOptions) {
  const [connected, setConnected] = useState(false);
  const [zones, setZones] = useState<WatchedZone[]>([]);
  const [pushLog, setPushLog] = useState<PushLogEntry[]>([]);
  const [nationalAlertCount, setNationalAlertCount] = useState<number>(0);
  const [lastHeartbeat, setLastHeartbeat] = useState<string | null>(null);

  const onAlertPushRef = useRef(onAlertPush);
  useEffect(() => {
    onAlertPushRef.current = onAlertPush;
  }, [onAlertPush]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let disposed = false;
    let attempt = 0;

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WsServerMessage;
          if (msg.type === 'state:init') {
            setZones(msg.zones);
            setPushLog(msg.pushLog);
            setNationalAlertCount(msg.activeCount);
          } else if (msg.type === 'zones:updated') {
            setZones(msg.zones);
          } else if (msg.type === 'alert:push') {
            setPushLog((prev) => {
              if (prev.some((item) => item.id === msg.entry.id)) return prev;
              return [msg.entry, ...prev].slice(0, 40);
            });
            onAlertPushRef.current(msg.entry, msg.alert);
          } else if (msg.type === 'alerts:heartbeat') {
            setNationalAlertCount(msg.activeCount);
            setLastHeartbeat(msg.timestamp);
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (!disposed) {
          const delay = Math.min(15000, 1500 * Math.pow(1.5, attempt));
          attempt += 1;
          reconnectTimer = window.setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  return {
    connected,
    zones,
    setZones,
    pushLog,
    nationalAlertCount,
    lastHeartbeat,
  };
}

import { useCallback, useEffect, useRef, useState } from 'react';

export type PushPermissionState = NotificationPermission | 'unsupported';

export function usePushNotifications(onNotificationClick?: (alertId: string) => void) {
  const [permission, setPermission] = useState<PushPermissionState>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }
    return Notification.permission;
  });
  const [swReady, setSwReady] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const swRegRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        swRegRef.current = reg;
        setSwReady(true);
      })
      .catch(() => {
        setSwReady(false);
      });

    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'NOTIFICATION_CLICKED' && onNotificationClick) {
        onNotificationClick(event.data.alertId || '');
      }
    };

    navigator.serviceWorker.addEventListener('message', handleSwMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage);
    };
  }, [onNotificationClick]);

  const requestPermission = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported');
      return 'unsupported' as PushPermissionState;
    }
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result;
    } catch {
      return permission;
    }
  }, [permission]);

  const playAlertChime = useCallback(() => {
    if (!audioEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const freqs = [587.33, 880];
      freqs.forEach((f, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, now + idx * 0.14);
        gain.gain.setValueAtTime(0.08, now + idx * 0.14);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.14 + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.14);
        osc.stop(now + idx * 0.14 + 0.26);
      });
    } catch {
      // Ignore audio restrictions
    }
  }, [audioEnabled]);

  const dispatchBrowserNotification = useCallback(
    async (title: string, body: string, alertId: string, severity: string) => {
      playAlertChime();

      if (typeof window === 'undefined' || !('Notification' in window)) return;
      if (Notification.permission !== 'granted') return;

      const options: NotificationOptions & { renotify?: boolean } = {
        body,
        tag: alertId || 'stormwatch-alert',
        requireInteraction: severity === 'EXTREME',
        data: { url: '/', alertId },
      };

      try {
        if (swRegRef.current) {
          await swRegRef.current.showNotification(title, options);
        } else {
          const n = new Notification(title, options);
          n.onclick = () => {
            window.focus();
            if (onNotificationClick) onNotificationClick(alertId);
            n.close();
          };
        }
      } catch {
        // Fallback inside restricted iframe contexts
      }
    },
    [onNotificationClick, playAlertChime]
  );

  return {
    permission,
    swReady,
    audioEnabled,
    setAudioEnabled,
    requestPermission,
    dispatchBrowserNotification,
  };
}

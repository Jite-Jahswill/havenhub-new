'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api/client';
import { useRealtimeConnection, useRealtimeEvent, useReconnect } from '@/lib/realtime';

/** Live unread in-app notification count for the dashboard navigation. */
export function UnreadNotificationsBadge() {
  const status = useRealtimeConnection();
  const [count, setCount] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void api<{ unread: number }>('GET', '/notifications/unread').then((res) => {
        if (res.success) setCount(res.data.unread);
      });
    }, 250);
  }, []);

  useEffect(() => {
    refresh();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);
  useReconnect(refresh);
  useRealtimeEvent('notifications.changed', refresh, status);

  if (count === 0) return null;
  return (
    <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[11px] leading-none font-bold text-primary-foreground">
      {count > 99 ? '99+' : count}
      <span className="sr-only"> unread notifications</span>
    </span>
  );
}

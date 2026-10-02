'use client';

import type { UnreadSummary } from '@havenhub/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api/client';
import { useRealtimeConnection, useRealtimeEvent, useReconnect } from '@/lib/realtime';

/** Live unread-message count for the dashboard navigation. */
export function UnreadMessagesBadge() {
  const status = useRealtimeConnection();
  const [count, setCount] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void api<UnreadSummary>('GET', '/conversations/unread').then((res) => {
        if (res.success) setCount(res.data.messages);
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
  useRealtimeEvent('message.created', refresh, status);
  useRealtimeEvent('message.read', refresh, status);
  useRealtimeEvent('message.deleted', refresh, status);

  if (count === 0) return null;
  return (
    <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[11px] leading-none font-bold text-primary-foreground">
      {count > 99 ? '99+' : count}
      <span className="sr-only"> unread messages</span>
    </span>
  );
}

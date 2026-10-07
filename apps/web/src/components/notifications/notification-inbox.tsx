'use client';

import type { NotificationPage, NotificationView } from '@havenhub/shared';
import { Alert, Button, Card, cn } from '@havenhub/ui';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api/client';
import { useRealtimeConnection, useRealtimeEvent } from '@/lib/realtime';

const TIME = new Intl.DateTimeFormat('en-NG', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Africa/Lagos',
});

/**
 * The inbox list. Opening a notification marks it read, then follows its
 * link. New notifications re-render the page through the realtime hint.
 */
export function NotificationInbox({
  page,
  basePath,
  unreadOnly,
}: {
  page: NotificationPage;
  basePath: string;
  unreadOnly: boolean;
}) {
  const router = useRouter();
  const status = useRealtimeConnection();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useRealtimeEvent('notifications.changed', () => router.refresh(), status);

  async function open(n: NotificationView) {
    if (!n.read) {
      const res = await api('POST', `/notifications/${n.id}/read`);
      if (!res.success) {
        setError(res.message);
        return;
      }
    }
    if (n.link) router.push(n.link);
    else router.refresh();
  }

  async function readAll() {
    setPending(true);
    const res = await api('POST', '/notifications/read-all');
    setPending(false);
    if (res.success) router.refresh();
    else setError(res.message);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter" className="flex gap-1 text-sm">
          {[
            { label: 'All', href: basePath, active: !unreadOnly },
            {
              label: `Unread (${page.unread})`,
              href: `${basePath}?unread=true`,
              active: unreadOnly,
            },
          ].map((tab) => (
            <Link
              key={tab.label}
              href={tab.href}
              aria-current={tab.active ? 'page' : undefined}
              className={cn(
                'rounded-control px-3 py-1.5',
                tab.active
                  ? 'bg-surface-secondary font-semibold text-text'
                  : 'text-text-secondary hover:text-text',
              )}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        {page.unread > 0 && (
          <Button variant="secondary" size="sm" loading={pending} onClick={() => void readAll()}>
            Mark all as read
          </Button>
        )}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {page.items.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-16 text-center">
          <Bell aria-hidden className="size-8 text-text-muted" strokeWidth={1.6} />
          <h2 className="mt-4 font-semibold text-text">
            {unreadOnly ? 'You’re all caught up' : 'No notifications yet'}
          </h2>
          <p className="mt-2 max-w-sm text-sm text-text-secondary">
            Booking updates, refunds and announcements from HavenHub appear here.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {page.items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => void open(n)}
                className="block w-full rounded-card text-left focus-visible:outline-2"
              >
                <Card
                  className={cn(
                    'flex gap-3 p-4 transition-colors hover:bg-surface-secondary/60',
                    !n.read && 'border-primary/40',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-1.5 size-2 shrink-0 rounded-full',
                      n.read ? 'bg-transparent' : 'bg-primary',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className={cn('text-text', !n.read && 'font-semibold')}>
                        {n.title}
                        {!n.read && <span className="sr-only"> (unread)</span>}
                      </span>
                      <time dateTime={n.createdAt} className="text-xs text-text-muted">
                        {TIME.format(new Date(n.createdAt))}
                      </time>
                    </span>
                    <span className="mt-1 block text-sm whitespace-pre-line text-text-secondary">
                      {n.body}
                    </span>
                  </span>
                </Card>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

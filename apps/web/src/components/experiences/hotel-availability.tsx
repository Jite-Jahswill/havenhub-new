'use client';

import { formatKobo, type HotelAvailabilityView, type RoomTypeView } from '@havenhub/shared';
import { Alert, Button, Spinner } from '@havenhub/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';

import { api } from '@/lib/api/client';

const DAYS = 14;
const DAY = new Intl.DateTimeFormat('en-NG', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const todayInLagos = () => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Rooms open per type for the next two weeks (catalogue information: nothing
 * is held or reserved). Loaded in the browser so the page itself stays cacheable.
 */
export function HotelAvailability({
  slug,
  roomTypes,
}: {
  slug: string;
  roomTypes: RoomTypeView[];
}) {
  const [from, setFrom] = useState(todayInLagos);
  const [data, setData] = useState<HotelAvailabilityView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const to = addDays(from, DAYS - 1);

  useEffect(() => {
    let cancelled = false;
    void api<HotelAvailabilityView>(
      'GET',
      `/experiences/${encodeURIComponent(slug)}/availability?from=${from}&to=${to}`,
    ).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.success) {
        setData(res.data);
        setError(null);
      } else setError(res.message);
    });
    return () => {
      cancelled = true;
    };
  }, [slug, from, to]);

  const go = (days: number) => {
    setLoading(true);
    setFrom(addDays(from, days));
  };
  const name = new Map(roomTypes.map((t) => [t.id, t.name]));
  const canGoBack = from > todayInLagos();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-text-secondary" aria-live="polite">
          {DAY.format(new Date(`${from}T00:00:00Z`))} – {DAY.format(new Date(`${to}T00:00:00Z`))}
        </p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-label="Previous two weeks"
            disabled={!canGoBack || loading}
            onClick={() => go(-DAYS)}
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Next two weeks"
            disabled={loading}
            onClick={() => go(DAYS)}
          >
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        </div>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Spinner /> Loading availability…
        </div>
      ) : data ? (
        <div className="relative overflow-x-auto rounded-control border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Rooms open per night</caption>
            <thead>
              <tr className="border-b border-border bg-surface-secondary text-left">
                <th
                  scope="col"
                  className="sticky left-0 bg-surface-secondary px-3 py-2 font-semibold"
                >
                  Room type
                </th>
                {data.roomTypes[0]?.days.map((d) => (
                  <th
                    key={d.date}
                    scope="col"
                    className="px-2 py-2 text-center text-xs font-medium"
                  >
                    {DAY.format(new Date(`${d.date}T00:00:00Z`))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={loading ? 'opacity-60' : undefined}>
              {data.roomTypes.map((type) => (
                <tr key={type.roomTypeId} className="border-b border-border last:border-0">
                  <th
                    scope="row"
                    className="sticky left-0 bg-surface px-3 py-2 text-left font-medium"
                  >
                    {name.get(type.roomTypeId) ?? 'Room'}
                  </th>
                  {type.days.map((d) => (
                    <td key={d.date} className="px-2 py-2 text-center">
                      {d.availableRooms > 0 ? (
                        <span className="flex flex-col">
                          <span className="font-semibold text-success">
                            {d.availableRooms} open
                          </span>
                          {d.minPriceKobo !== null && (
                            <span className="text-xs text-text-muted">
                              {formatKobo(d.minPriceKobo)}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-text-muted">Full</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

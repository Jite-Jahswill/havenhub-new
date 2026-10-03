import { formatKobo, type AnalyticsRange, type Metric } from '@havenhub/shared';
import { Badge, Button, Card, Input } from '@havenhub/ui';

import { formatDay } from '@/lib/format';

export type MetricFormat = 'count' | 'kobo' | 'percent';

const COUNT = new Intl.NumberFormat('en-NG');
const PERCENT = new Intl.NumberFormat('en-NG', { style: 'percent', maximumFractionDigits: 1 });

function show(value: number, format: MetricFormat) {
  if (format === 'kobo') return formatKobo(value);
  if (format === 'percent') return PERCENT.format(value);
  return COUNT.format(value);
}

/** One figure, or an explicit "Not available" with the reason — never a fake zero. */
export function MetricCard({
  label,
  metric,
  format = 'count',
  hint,
}: {
  label: string;
  metric: Metric;
  format?: MetricFormat;
  hint?: string;
}) {
  return (
    <Card className="p-5">
      <p className="text-sm text-text-secondary">{label}</p>
      {metric.available ? (
        <p className="mt-2 text-2xl font-bold tracking-tight break-words text-text tabular-nums sm:text-3xl">
          {show(metric.value, format)}
        </p>
      ) : (
        <p className="mt-3">
          <Badge>Not available</Badge>
        </p>
      )}
      <p className="mt-1 text-xs text-text-muted">{metric.available ? hint : metric.reason}</p>
    </Card>
  );
}

/** A GET form, so a range is a shareable URL. Dates are Nigerian calendar days. */
export function RangeForm({ range, action }: { range: AnalyticsRange; action: string }) {
  return (
    <form
      action={action}
      className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end"
      aria-label="Date range"
    >
      <label className="flex flex-col gap-1.5 text-sm font-medium text-text">
        From
        <Input type="date" name="from" defaultValue={range.from} required className="sm:w-44" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-text">
        To
        <Input type="date" name="to" defaultValue={range.to} required className="sm:w-44" />
      </label>
      <Button type="submit" variant="secondary">
        Apply
      </Button>
      <p className="text-sm text-text-muted sm:ml-auto">
        {formatDay(range.from)} – {formatDay(range.to)} (WAT)
      </p>
    </form>
  );
}

export const rangeQuery = (sp: Record<string, string | string[] | undefined>) => {
  const q = new URLSearchParams();
  for (const key of ['from', 'to']) {
    const v = sp[key];
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) q.set(key, v);
  }
  return q.toString();
};

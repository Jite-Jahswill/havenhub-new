import type { UsageItem } from '@havenhub/shared';
import { cn } from '@havenhub/ui';

import { formatLimit } from '@/lib/format';

const unitText = (value: number, unit: UsageItem['unit']) =>
  unit === 'MB' ? `${value} MB` : value.toLocaleString('en-NG');

/**
 * Usage against plan limits. Each meter states its numbers in text — colour
 * is never the only signal — and exposes a labelled progressbar.
 */
export function UsageMeters({ usage, compact = false }: { usage: UsageItem[]; compact?: boolean }) {
  const shown = usage.filter((u) => u.enforced && (!compact || u.limit !== 0));
  return (
    <ul className="grid gap-5 sm:grid-cols-2">
      {shown.map((item) => {
        const used = item.used ?? 0;
        const unlimited = item.limit === null;
        const over = item.limit !== null && used > item.limit;
        const atLimit = item.limit !== null && used >= item.limit;
        const percent = unlimited
          ? 0
          : item.limit === 0
            ? 100
            : Math.min(100, Math.round((used / item.limit!) * 100));
        const caption =
          item.scope === 'perProperty' ? `${item.label} (fullest listing)` : item.label;
        const figures =
          item.limit === 0 && used === 0
            ? 'Not included'
            : `${unitText(used, item.unit)} / ${formatLimit(item.limit, item.unit)}`;
        const status = over
          ? 'Over your plan limit'
          : atLimit
            ? item.limit === 0
              ? 'Upgrade to unlock'
              : 'Limit reached'
            : unlimited
              ? 'Unlimited'
              : null;
        return (
          <li key={item.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-text">{caption}</span>
              <span className="shrink-0 text-text-secondary tabular-nums">{figures}</span>
            </div>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-surface-secondary"
              role="progressbar"
              aria-label={caption}
              aria-valuemin={0}
              aria-valuemax={item.limit ?? undefined}
              aria-valuenow={used}
              aria-valuetext={figures.replace(' / ', ' of ')}
            >
              <div
                className={cn('h-full rounded-full', over || atLimit ? 'bg-warning' : 'bg-primary')}
                style={{ width: `${percent}%` }}
              />
            </div>
            {status && (
              <p className={cn('mt-1.5 text-xs', over ? 'text-warning' : 'text-text-muted')}>
                {status}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

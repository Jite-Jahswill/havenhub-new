import { formatKobo } from '@havenhub/shared';
import { cn } from '@havenhub/ui';

/** Label/amount rows for financial summaries. */
export function MoneyRows({
  rows,
}: {
  rows: { label: string; kobo: number; strong?: boolean; negative?: boolean; hint?: string }[];
}) {
  return (
    <dl className="flex flex-col gap-2 text-sm">
      {rows.map((row) => (
        <div
          key={row.label}
          className={cn(
            'flex items-baseline justify-between gap-4',
            row.strong && 'mt-1 border-t border-border pt-3',
          )}
        >
          <dt className={row.strong ? 'font-semibold text-text' : 'text-text-secondary'}>
            {row.label}
            {row.hint && <span className="block text-xs text-text-muted">{row.hint}</span>}
          </dt>
          <dd
            className={cn(
              'shrink-0 tabular-nums',
              row.strong ? 'font-bold text-text' : 'text-text',
            )}
          >
            {row.negative && row.kobo > 0 ? `−${formatKobo(row.kobo)}` : formatKobo(row.kobo)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

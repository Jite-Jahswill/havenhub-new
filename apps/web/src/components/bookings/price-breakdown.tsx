import { formatKobo, type PriceLine } from '@havenhub/shared';
import { cn } from '@havenhub/ui';

/**
 * The server-calculated breakdown, line by line. Nothing here is computed in
 * the browser except the formatting.
 */
export function PriceBreakdown({
  lines,
  totalKobo,
  depositKobo,
  className,
}: {
  lines: PriceLine[];
  totalKobo: number;
  depositKobo: number;
  className?: string;
}) {
  return (
    <div className={cn('text-sm', className)}>
      <dl className="flex flex-col gap-2">
        {lines.map((line) => (
          <div key={line.kind} className="flex items-baseline justify-between gap-4">
            <dt className="text-text-secondary">
              {line.label}
              {line.quantity !== null && line.unitAmountKobo !== null && (
                <span className="block text-xs text-text-muted">
                  {formatKobo(Math.abs(line.unitAmountKobo))} × {line.quantity}
                </span>
              )}
            </dt>
            <dd
              className={cn(
                'shrink-0 text-text tabular-nums',
                line.amountKobo < 0 && 'text-success',
              )}
            >
              {line.amountKobo < 0
                ? `−${formatKobo(-line.amountKobo)}`
                : formatKobo(line.amountKobo)}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-border pt-3">
        <span className="font-semibold text-text">Total</span>
        <span className="text-lg font-bold text-text tabular-nums">{formatKobo(totalKobo)}</span>
      </div>
      {depositKobo > 0 && (
        <p className="mt-2 text-xs text-text-muted">
          Includes a refundable caution deposit of {formatKobo(depositKobo)}.
        </p>
      )}
    </div>
  );
}

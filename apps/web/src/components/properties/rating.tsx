import type { RatingSummary } from '@havenhub/shared';
import { cn } from '@havenhub/ui';
import { Star } from 'lucide-react';

/** "★ 4.7 (12 reviews)": nothing until the first review. */
export function Rating({
  rating,
  className,
  long = false,
}: {
  rating: RatingSummary | null;
  className?: string;
  /** "12 reviews" instead of "(12)". */
  long?: boolean;
}) {
  if (!rating) return null;
  return (
    <span className={cn('inline-flex items-center gap-1 text-sm text-text', className)}>
      <Star aria-hidden className="size-4 fill-amber-400 text-amber-400" />
      <span className="font-semibold">{rating.average.toFixed(1)}</span>
      <span className="text-text-secondary">
        {long
          ? `· ${rating.count} ${rating.count === 1 ? 'review' : 'reviews'}`
          : `(${rating.count})`}
      </span>
      <span className="sr-only">
        out of 5 stars from {rating.count} {rating.count === 1 ? 'review' : 'reviews'}
      </span>
    </span>
  );
}

/** Five stars, filled up to `value` (for a single review). */
export function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span
      className={cn('inline-flex', className)}
      aria-label={`${value} out of 5 stars`}
      role="img"
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={cn(
            'size-4',
            n <= value ? 'fill-amber-400 text-amber-400' : 'fill-transparent text-border-strong',
          )}
        />
      ))}
    </span>
  );
}

import type { PublicBadge } from '@havenhub/shared';
import { cn } from '@havenhub/ui';
import Image from 'next/image';

/**
 * Badges a property holds. Compact: small icons (name on hover and for
 * screen readers), for cards. Full: icon with name, for the property page.
 */
export function PropertyBadges({
  badges,
  compact = false,
  className,
}: {
  badges: PublicBadge[];
  compact?: boolean;
  className?: string;
}) {
  if (badges.length === 0) return null;
  const shown = compact ? badges.slice(0, 3) : badges;
  return (
    <ul className={cn('flex flex-wrap gap-2', className)} aria-label="Badges">
      {shown.map((badge) => (
        <li
          key={badge.id}
          title={badge.description ? `${badge.name}: ${badge.description}` : badge.name}
          className={cn(
            'flex items-center gap-2',
            !compact &&
              'rounded-full border border-border bg-surface py-1 pr-3 pl-1 text-sm text-text',
          )}
        >
          <span
            className={cn(
              'relative shrink-0 overflow-hidden rounded-full bg-surface shadow-card',
              compact ? 'size-8' : 'size-7',
            )}
          >
            <Image
              src={badge.imageUrl}
              alt=""
              fill
              unoptimized
              sizes="32px"
              className="object-contain"
            />
          </span>
          {compact ? <span className="sr-only">{badge.name}</span> : badge.name}
        </li>
      ))}
    </ul>
  );
}

import {
  EXPERIENCE_KIND_LABELS,
  TOUR_CATEGORY_LABELS,
  formatKobo,
  type ExperienceCard as ExperienceCardData,
} from '@havenhub/shared';
import { Badge } from '@havenhub/ui';
import { BadgeCheck, CalendarDays, ImageOff, MapPin } from 'lucide-react';
import Link from 'next/link';

import { Photo } from '@/components/properties/photo';
import { experiencePath, formatEventTime } from '@/lib/experiences';

/** Public card for an event, tour, hotel or cleaning service. Prices are listed, not sold. */
export function ExperienceCard({
  item,
  priority = false,
}: {
  item: ExperienceCardData;
  priority?: boolean;
}) {
  const place = [item.city, item.state].filter(Boolean).join(', ');
  const badge =
    item.kind === 'TOUR' && item.category
      ? TOUR_CATEGORY_LABELS[item.category]
      : EXPERIENCE_KIND_LABELS[item.kind].one;
  return (
    <article className="group relative flex flex-col">
      <div className="relative aspect-[4/3] overflow-hidden rounded-card bg-surface-secondary">
        {item.coverImage ? (
          <Photo
            src={item.coverImage.url}
            alt={item.coverImage.altText ?? item.title}
            priority={priority}
            className="transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="grid size-full place-items-center text-text-muted">
            <ImageOff aria-hidden className="size-8" strokeWidth={1.4} />
          </div>
        )}
        <div className="absolute top-3 left-3">
          <Badge className="bg-surface/90 text-text backdrop-blur">{badge}</Badge>
        </div>
      </div>
      <div className="mt-3.5 flex flex-col gap-1 px-0.5">
        {item.startsAt && (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-primary-text">
            <CalendarDays aria-hidden className="size-3.5" />
            {item.kind === 'TOUR' ? 'Next: ' : ''}
            {formatEventTime(item.startsAt)}
          </p>
        )}
        <h3 className="line-clamp-2 font-semibold text-text">
          <Link
            href={experiencePath(item.kind, item.slug)}
            className="after:absolute after:inset-0 focus-visible:outline-none"
          >
            {item.title}
          </Link>
        </h3>
        {(place || item.serviceAreas.length > 0) && (
          <p className="flex items-center gap-1 text-sm text-text-secondary">
            <MapPin aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">
              {item.kind === 'CLEANING' && item.serviceAreas.length
                ? `Serves ${item.serviceAreas.slice(0, 3).join(', ')}${item.serviceAreas.length > 3 ? '…' : ''}`
                : place}
            </span>
          </p>
        )}
        {item.priceFromKobo !== null && (
          <p className="mt-1 text-text">
            <span className="text-sm text-text-secondary">From </span>
            <span className="font-semibold">{formatKobo(item.priceFromKobo)}</span>
            {(item.priceNote || item.kind === 'HOTEL') && (
              <span className="text-sm text-text-secondary">
                {' '}
                {item.kind === 'HOTEL' ? 'per night' : item.priceNote}
              </span>
            )}
          </p>
        )}
        <p className="flex items-center gap-1 text-xs text-text-muted">
          <BadgeCheck aria-hidden className="size-3.5 text-success" />
          <span className="truncate">{item.agent.displayName}</span>
          <span className="sr-only">(verified)</span>
        </p>
      </div>
    </article>
  );
}

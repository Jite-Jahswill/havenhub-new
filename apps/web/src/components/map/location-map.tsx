import { cn } from '@havenhub/ui';
import { MapPin } from 'lucide-react';

import { googleEmbedUrl, googleMapsLink } from './google-maps';

/** Read-only Google map of one location, with a link to open it in Google Maps. */
export function LocationMap({
  latitude,
  longitude,
  className,
  zoom = 15,
  title = 'Property location map',
}: {
  latitude: number | null;
  longitude: number | null;
  className?: string;
  zoom?: number;
  title?: string;
}) {
  if (latitude === null || longitude === null) {
    return (
      <div
        className={cn(
          'grid size-full place-items-center bg-surface-secondary text-sm text-text-muted',
          className,
        )}
      >
        <span className="flex items-center gap-2">
          <MapPin aria-hidden className="size-4" /> No location set yet
        </span>
      </div>
    );
  }
  return (
    <div className={cn('relative size-full', className)}>
      <iframe
        title={title}
        src={googleEmbedUrl(latitude, longitude, zoom)}
        className="size-full border-0"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
      />
      <a
        href={googleMapsLink(latitude, longitude)}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute right-2 bottom-2 rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-text shadow-raised hover:bg-surface-secondary"
      >
        Open in Google Maps
      </a>
    </div>
  );
}

'use client';

import { cn } from '@havenhub/ui';
import { Heart } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api/client';

export type Viewer = 'guest' | 'customer' | 'other';

/**
 * Favourites are a customer feature. Guests are sent to sign in; agents and
 * admins don't see the control at all.
 */
export function FavoriteButton({
  propertyId,
  initial,
  viewer,
  variant = 'overlay',
}: {
  propertyId: string;
  initial: boolean;
  viewer: Viewer;
  variant?: 'overlay' | 'inline';
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [favorite, setFavorite] = useState(initial);
  const [pending, setPending] = useState(false);
  if (viewer === 'other') return null;

  async function toggle(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (viewer === 'guest') {
      router.push(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    const next = !favorite;
    setFavorite(next);
    setPending(true);
    const res = await api(next ? 'PUT' : 'DELETE', `/favorites/${propertyId}`);
    setPending(false);
    if (!res.success) setFavorite(!next);
  }

  const label = favorite ? 'Remove from favourites' : 'Save to favourites';
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={favorite}
      aria-label={label}
      title={label}
      className={cn(
        'grid place-items-center rounded-full transition-transform active:scale-90',
        variant === 'overlay'
          ? 'size-9 bg-surface/90 text-text shadow-card backdrop-blur hover:scale-105'
          : 'h-10 gap-2 border border-border px-4 text-sm font-medium hover:bg-surface-secondary [&]:flex',
      )}
    >
      <Heart
        aria-hidden
        className={cn('size-4.5', favorite && 'fill-primary text-primary')}
        strokeWidth={favorite ? 2 : 1.8}
      />
      {variant === 'inline' && <span>{favorite ? 'Saved' : 'Save'}</span>}
    </button>
  );
}

import { cn } from '@havenhub/ui';
import Image from 'next/image';

/**
 * Listing photos are already resized and re-encoded to WebP at upload time
 * (two renditions), so they are served as-is rather than re-optimised.
 */
export function Photo({
  src,
  alt,
  className,
  sizes = '(max-width: 640px) 100vw, 400px',
  priority = false,
}: {
  src: string;
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={src}
      alt={alt}
      fill
      unoptimized
      sizes={sizes}
      priority={priority}
      className={cn('object-cover', className)}
    />
  );
}

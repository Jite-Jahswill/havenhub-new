import { cn } from '@havenhub/ui';

import { Photo } from '@/components/properties/photo';
import { initials } from './chat-utils';

export function ChatAvatar({
  name,
  url,
  size = 'md',
}: {
  name: string;
  url: string | null;
  size?: 'sm' | 'md';
}) {
  const box = size === 'sm' ? 'size-8 text-xs' : 'size-10 text-sm';
  return (
    <span
      aria-hidden
      className={cn(
        'relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-surface-secondary font-semibold text-text-secondary',
        box,
      )}
    >
      {url ? <Photo src={url} alt="" sizes="40px" /> : initials(name)}
    </span>
  );
}

'use client';

import type { CmsImage } from '@havenhub/shared';
import { Button } from '@havenhub/ui';
import { useState } from 'react';

import { Photo } from '@/components/properties/photo';

import { MediaPicker } from './media-picker';

/** A single image chosen from the media library (cover, OG image, photo). */
export function ImageField({
  label,
  value,
  onChange,
  canUpload,
  disabled,
}: {
  label: string;
  value: CmsImage | null;
  onChange: (image: CmsImage | null) => void;
  canUpload: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-text">{label}</span>
      <div className="flex items-center gap-3">
        <div className="relative aspect-[16/10] w-36 shrink-0 overflow-hidden rounded-control border border-border bg-surface-secondary">
          {value ? (
            <Photo src={value.thumbnailUrl} alt="" sizes="144px" />
          ) : (
            <span className="grid size-full place-items-center text-xs text-text-muted">None</span>
          )}
        </div>
        {!disabled && (
          <div className="flex flex-col gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
              {value ? 'Change' : 'Choose image'}
            </Button>
            {value && (
              <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
                Remove
              </Button>
            )}
          </div>
        )}
      </div>
      <MediaPicker
        open={open}
        onClose={() => setOpen(false)}
        onPick={onChange}
        canUpload={canUpload}
      />
    </div>
  );
}

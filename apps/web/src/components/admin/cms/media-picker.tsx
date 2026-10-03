'use client';

import type { CmsImage, CmsMediaView, Paginated } from '@havenhub/shared';
import { Alert, Button, Spinner } from '@havenhub/ui';
import { ImagePlus, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Photo } from '@/components/properties/photo';
import { api, apiUpload } from '@/lib/api/client';

/**
 * Pick an image from the CMS media library (or upload one, if allowed).
 * Uses a native <dialog>, so focus, Escape and the backdrop behave correctly.
 */
export function MediaPicker({
  open,
  onClose,
  onPick,
  canUpload,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (image: CmsImage) => void;
  canUpload: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<CmsMediaView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    const res = await api<Paginated<CmsMediaView>>('GET', '/admin/cms/media?pageSize=60');
    if (res.success) setItems(res.data.items);
    else setError(res.message);
  }, []);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      void load();
    }
    if (!open && d.open) d.close();
  }, [open, load]);

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    const res = await apiUpload<CmsMediaView>('/admin/cms/media', file);
    setUploading(false);
    if (input.current) input.current.value = '';
    if (!res.success) setError(res.message);
    else setItems((list) => [res.data, ...(list ?? [])]);
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-label="Choose an image"
      className="m-auto w-[min(92vw,760px)] rounded-card border border-border bg-surface p-0 text-text shadow-raised backdrop:bg-black/50"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="font-semibold">Media library</h2>
        <div className="flex items-center gap-2">
          {canUpload && (
            <>
              <Button
                size="sm"
                variant="secondary"
                loading={uploading}
                onClick={() => input.current?.click()}
              >
                <ImagePlus aria-hidden className="size-4" /> Upload
              </Button>
              <input
                ref={input}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                className="sr-only"
                tabIndex={-1}
                aria-label="Upload image"
                onChange={(e) => void upload(e.target.files)}
              />
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-9 place-items-center rounded-full hover:bg-surface-secondary"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      </div>
      <div className="max-h-[65vh] overflow-y-auto p-5">
        {error && (
          <Alert tone="error" className="mb-4">
            {error}
          </Alert>
        )}
        {!items ? (
          <p className="flex items-center gap-2 text-sm text-text-secondary">
            <Spinner /> Loading…
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-text-secondary">
            No images yet{canUpload ? ' — upload one.' : '.'}
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {items.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(m);
                    onClose();
                  }}
                  className="group relative block aspect-[4/3] w-full overflow-hidden rounded-control bg-surface-secondary focus-visible:outline-2 focus-visible:outline-primary"
                  aria-label={`Use ${m.altText ?? 'image'} (${m.width}×${m.height})`}
                >
                  <Photo src={m.thumbnailUrl} alt="" sizes="180px" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </dialog>
  );
}

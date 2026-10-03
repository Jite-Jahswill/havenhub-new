'use client';

import type { CmsMediaView } from '@havenhub/shared';
import { Alert, Button, Input } from '@havenhub/ui';
import { Copy, ImagePlus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { Photo } from '@/components/properties/photo';
import { api, apiUpload } from '@/lib/api/client';

/** Upload, describe (alt text) and delete CMS images. Images in use cannot be deleted. */
export function MediaLibrary({ items, canManage }: { items: CmsMediaView[]; canManage: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    for (const file of Array.from(files).slice(0, 10)) {
      const res = await apiUpload('/admin/cms/media', file);
      if (!res.success) {
        setError(`${file.name}: ${res.message}`);
        break;
      }
    }
    setUploading(false);
    if (input.current) input.current.value = '';
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      {error && <Alert tone="error">{error}</Alert>}
      {canManage && (
        <div>
          <Button loading={uploading} onClick={() => input.current?.click()}>
            <ImagePlus aria-hidden className="size-4" /> Upload images
          </Button>
          <input
            ref={input}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="sr-only"
            tabIndex={-1}
            aria-label="Upload images"
            onChange={(e) => void upload(e.target.files)}
          />
          <p className="mt-2 text-xs text-text-muted">
            JPEG, PNG, WebP or AVIF, up to 10 MB. Location data is removed.
          </p>
        </div>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-text-secondary">No images yet.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((m) => (
            <MediaTile key={m.id} item={m} canManage={canManage} onError={setError} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MediaTile({
  item,
  canManage,
  onError,
}: {
  item: CmsMediaView;
  canManage: boolean;
  onError: (e: string | null) => void;
}) {
  const router = useRouter();
  const [alt, setAlt] = useState(item.altText ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <li className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3">
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="relative block aspect-[4/3] overflow-hidden rounded-control bg-surface-secondary"
      >
        <Photo src={item.thumbnailUrl} alt={item.altText ?? ''} sizes="300px" />
      </a>
      <p className="text-xs text-text-muted">
        {item.width}×{item.height} · {Math.ceil(item.bytes / 1024)} KB
      </p>
      {canManage ? (
        <div className="flex gap-2">
          <Input
            aria-label="Alt text"
            placeholder="Describe the image"
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            maxLength={200}
            className="h-9 text-xs"
          />
          <Button
            size="sm"
            variant="secondary"
            loading={busy === 'alt'}
            disabled={alt === (item.altText ?? '')}
            onClick={async () => {
              setBusy('alt');
              const res = await api('PATCH', `/admin/cms/media/${item.id}`, { altText: alt });
              setBusy(null);
              onError(res.success ? null : res.message);
              router.refresh();
            }}
          >
            Save
          </Button>
        </div>
      ) : (
        item.altText && <p className="text-xs text-text-secondary">{item.altText}</p>
      )}
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            await navigator.clipboard.writeText(`![${alt}](${item.url})`).catch(() => undefined);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          <Copy aria-hidden className="size-4" /> {copied ? 'Copied' : 'Copy Markdown'}
        </Button>
        {canManage && (
          <Button
            size="sm"
            variant="ghost"
            aria-label="Delete image"
            loading={busy === 'delete'}
            onClick={async () => {
              if (!window.confirm('Delete this image?')) return;
              setBusy('delete');
              const res = await api('DELETE', `/admin/cms/media/${item.id}`);
              setBusy(null);
              onError(res.success ? null : res.message);
              router.refresh();
            }}
          >
            <Trash2 aria-hidden className="size-4" />
          </Button>
        )}
      </div>
    </li>
  );
}

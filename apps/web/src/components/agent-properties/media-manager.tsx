'use client';

import { ErrorCode, parseVideoUrl, type AgentPropertyView } from '@havenhub/shared';
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Spinner, cn } from '@havenhub/ui';
import { ArrowLeft, ArrowRight, ImagePlus, Star, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

import { Photo } from '@/components/properties/photo';
import { api, apiUpload } from '@/lib/api/client';
import { formText } from '@/lib/form';

/** Plan allowances for display; null = unlimited. The API enforces them regardless. */
type Limits = { images: number | null; videos: number | null };

export function MediaManager({
  property,
  limits,
  locked,
}: {
  property: AgentPropertyView;
  limits: Limits;
  locked: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; upgrade: boolean } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const base = `/agents/me/properties/${property.id}`;
  const images = property.images;
  const remaining =
    limits.images === null ? Number.POSITIVE_INFINITY : limits.images - images.length;

  async function call(
    key: string,
    request: () => Promise<{ success: boolean; message?: string; code?: string }>,
  ) {
    setBusy(key);
    setError(null);
    const res = await request();
    setBusy(null);
    if (!res.success)
      setError({ text: res.message ?? 'Something went wrong.', upgrade: isLimit(res.code) });
    router.refresh();
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, Math.max(remaining, 0));
    setError(null);
    setProgress({ done: 0, total: list.length });
    for (const [index, file] of list.entries()) {
      const res = await apiUpload<AgentPropertyView>(`${base}/images`, file);
      if (!res.success) {
        setError({ text: `${file.name}: ${res.message}`, upgrade: isLimit(res.code) });
        break;
      }
      setProgress({ done: index + 1, total: list.length });
    }
    setProgress(null);
    if (input.current) input.current.value = '';
    router.refresh();
  }

  function move(index: number, delta: number) {
    const ids = images.map((i) => i.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved!);
    void call(`move-${index}`, () => api('PATCH', `${base}/images/order`, { imageIds: ids }));
  }

  return (
    <Card id="media" className="scroll-mt-28">
      <CardHeader
        title="Photos & video"
        description={`${limits.images === null ? 'Unlimited' : `Up to ${limits.images}`} photos (JPEG, PNG, WebP; max 10 MB each) and ${limits.videos === null ? 'unlimited video links' : `${limits.videos} video ${limits.videos === 1 ? 'link' : 'links'}`} on your plan. Photo location data is removed automatically.`}
      />
      <CardBody className="flex flex-col gap-6">
        {error && (
          <Alert tone="error" className="flex items-start justify-between gap-3">
            <span>
              {error.text}
              {error.upgrade && <UpgradeLink />}
            </span>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
              <X aria-hidden className="size-4" />
            </button>
          </Alert>
        )}

        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {images.map((image, index) => (
            <li
              key={image.id}
              className="group relative aspect-[4/3] overflow-hidden rounded-control bg-surface-secondary"
            >
              <Photo
                src={image.thumbnailUrl}
                alt={image.altText ?? `Photo ${index + 1}`}
                sizes="240px"
              />
              {image.isPrimary && (
                <span className="absolute top-2 left-2 rounded-full bg-surface-inverse px-2 py-0.5 text-[11px] font-semibold text-text-inverse">
                  Cover
                </span>
              )}
              {!locked && (
                <div className="absolute inset-x-2 bottom-2 flex justify-between gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                  <div className="flex gap-1">
                    <IconButton
                      label="Move earlier"
                      disabled={index === 0 || Boolean(busy)}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowLeft className="size-4" />
                    </IconButton>
                    <IconButton
                      label="Move later"
                      disabled={index === images.length - 1 || Boolean(busy)}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowRight className="size-4" />
                    </IconButton>
                  </div>
                  <div className="flex gap-1">
                    {!image.isPrimary && (
                      <IconButton
                        label="Use as cover photo"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          call(`primary-${image.id}`, () =>
                            api('PATCH', `${base}/images/${image.id}`, { isPrimary: true }),
                          )
                        }
                      >
                        <Star className="size-4" />
                      </IconButton>
                    )}
                    <IconButton
                      label="Delete photo"
                      disabled={Boolean(busy)}
                      onClick={() => {
                        if (window.confirm('Delete this photo?')) {
                          void call(`delete-${image.id}`, () =>
                            api('DELETE', `${base}/images/${image.id}`),
                          );
                        }
                      }}
                    >
                      {busy === `delete-${image.id}` ? <Spinner /> : <Trash2 className="size-4" />}
                    </IconButton>
                  </div>
                </div>
              )}
            </li>
          ))}
          {!locked && remaining > 0 && (
            <li>
              <button
                type="button"
                onClick={() => input.current?.click()}
                disabled={Boolean(progress)}
                className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-control border-2 border-dashed border-border-strong text-sm text-text-secondary hover:border-primary hover:text-text"
              >
                {progress ? (
                  <>
                    <Spinner /> Uploading{' '}
                    {progress.done + 1 > progress.total ? progress.total : progress.done + 1} of{' '}
                    {progress.total}
                  </>
                ) : (
                  <>
                    <ImagePlus aria-hidden className="size-6" strokeWidth={1.6} />
                    Add photos{Number.isFinite(remaining) ? ` (${remaining} left)` : ''}
                  </>
                )}
              </button>
              <input
                ref={input}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                multiple
                className="sr-only"
                aria-label="Upload photos"
                onChange={(e) => void upload(e.target.files)}
              />
            </li>
          )}
        </ul>
        {images.length === 0 && (
          <p className="text-sm text-text-secondary">
            Add at least one photo before submitting for review.
          </p>
        )}
        {!locked && remaining <= 0 && (
          <p className="text-sm text-text-secondary">
            You have used all {limits.images} photos your plan allows for this property.{' '}
            <UpgradeLink />
          </p>
        )}

        <VideoSection
          property={property}
          limit={limits.videos}
          locked={locked}
          onChange={() => router.refresh()}
        />
      </CardBody>
    </Card>
  );
}

function VideoSection({
  property,
  limit,
  locked,
  onChange,
}: {
  property: AgentPropertyView;
  limit: number | null;
  locked: boolean;
  onChange: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState(false);
  const [pending, setPending] = useState(false);
  const base = `/agents/me/properties/${property.id}/videos`;

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const url = formText(new FormData(formElement), 'url');
    if (!parseVideoUrl(url)) {
      setError('Paste a YouTube or Vimeo link.');
      return;
    }
    setPending(true);
    const res = await api('POST', base, { url });
    setPending(false);
    setUpgrade(!res.success && isLimit(res.code));
    if (!res.success) setError(res.message);
    else {
      setError(null);
      formElement.reset();
      onChange();
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-6">
      <h3 className="text-sm font-semibold text-text">Video tour</h3>
      {property.videos.map((video) => (
        <div
          key={video.id}
          className="flex items-center justify-between gap-3 rounded-control bg-surface-secondary px-4 py-3 text-sm"
        >
          <span>
            {video.provider === 'YOUTUBE' ? 'YouTube' : 'Vimeo'} · {video.externalId}
          </span>
          {!locked && (
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await api('DELETE', `${base}/${video.id}`);
                onChange();
              }}
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      {upgrade && (
        <p className="text-sm text-text-secondary">
          <UpgradeLink />
        </p>
      )}
      {!locked && limit !== null && property.videos.length >= limit && (
        <p className="text-sm text-text-secondary">
          Your plan allows {limit} {limit === 1 ? 'video' : 'videos'} per property. <UpgradeLink />
        </p>
      )}
      {!locked && (limit === null || property.videos.length < limit) && (
        <form onSubmit={add} noValidate className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="YouTube or Vimeo link" error={error ?? undefined} className="flex-1">
            {(a) => <Input {...a} name="url" type="url" placeholder="https://youtu.be/…" />}
          </Field>
          <Button
            type="submit"
            variant="secondary"
            loading={pending}
            className={cn(error && 'sm:mb-5')}
          >
            Add video
          </Button>
        </form>
      )}
    </div>
  );
}

function IconButton({
  label,
  children,
  ...props
}: { label: string; children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="grid size-8 place-items-center rounded-full bg-surface/95 text-text shadow-card hover:bg-surface disabled:opacity-40"
      {...props}
    >
      {children}
    </button>
  );
}

const isLimit = (code: string | undefined) => code === ErrorCode.PLAN_LIMIT_REACHED;

function UpgradeLink() {
  return (
    <Link
      href="/agent/subscription/plans"
      className="ml-1 font-semibold whitespace-nowrap underline underline-offset-4"
    >
      View plans
    </Link>
  );
}

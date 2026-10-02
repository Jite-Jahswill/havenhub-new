'use client';

import type { PropertyImageView } from '@havenhub/shared';
import { Button, cn } from '@havenhub/ui';
import { ChevronLeft, ChevronRight, Grid2X2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Photo } from './photo';

/** Hero mosaic (up to five photos) plus an accessible full-screen viewer. */
export function Gallery({ images, title }: { images: PropertyImageView[]; title: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const show = (index: number) => {
    setOpen(index);
    dialog.current?.showModal();
  };
  const close = useCallback(() => {
    dialog.current?.close();
    setOpen(null);
  }, []);
  const step = useCallback(
    (delta: number) =>
      setOpen((i) => (i === null ? i : (i + delta + images.length) % images.length)),
    [images.length],
  );

  useEffect(() => {
    if (open === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') step(1);
      if (event.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, step]);

  const tiles = images.slice(0, 5);
  const current = open === null ? null : images[open];

  return (
    <>
      <div
        className={cn(
          'relative grid gap-2 overflow-hidden rounded-card',
          tiles.length >= 3
            ? 'h-72 grid-cols-4 grid-rows-2 sm:h-[460px]'
            : 'h-72 grid-cols-1 sm:h-[460px]',
          tiles.length === 2 && 'sm:grid-cols-2',
        )}
      >
        {tiles.map((image, index) => (
          <button
            key={image.id}
            type="button"
            onClick={() => show(index)}
            className={cn(
              'relative overflow-hidden bg-surface-secondary focus-visible:z-10',
              tiles.length >= 3 && index === 0 && 'col-span-4 row-span-2 sm:col-span-2',
              tiles.length >= 3 && index > 0 && 'hidden sm:block',
              tiles.length === 3 && index > 0 && 'sm:col-span-2',
              tiles.length === 4 && index === 3 && 'sm:col-span-2',
            )}
            aria-label={`Open photo ${index + 1} of ${images.length}`}
          >
            <Photo
              src={index === 0 ? image.url : image.thumbnailUrl}
              alt={image.altText ?? `${title} — photo ${index + 1}`}
              priority={index === 0}
              sizes={index === 0 ? '(max-width: 640px) 100vw, 640px' : '320px'}
              className="transition-transform duration-500 hover:scale-[1.02]"
            />
          </button>
        ))}
        {images.length > 1 && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => show(0)}
            className="absolute right-4 bottom-4 shadow-raised"
          >
            <Grid2X2 aria-hidden className="size-4" /> Show all {images.length} photos
          </Button>
        )}
      </div>

      <dialog
        ref={dialog}
        onClose={() => setOpen(null)}
        aria-label={`${title} photos`}
        className="m-0 h-dvh max-h-none w-screen max-w-none bg-black/95 p-0 text-white backdrop:bg-black/80"
      >
        {current && (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between px-4 py-3 text-sm">
              <span>
                {open! + 1} / {images.length}
              </span>
              <button
                type="button"
                onClick={close}
                className="grid size-10 place-items-center rounded-full hover:bg-white/10"
                aria-label="Close"
              >
                <X aria-hidden className="size-5" />
              </button>
            </div>
            <div className="relative flex-1">
              <Photo
                src={current.url}
                alt={current.altText ?? title}
                sizes="100vw"
                className="object-contain"
              />
              {images.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    aria-label="Previous photo"
                    className="absolute top-1/2 left-3 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 hover:bg-white/20"
                  >
                    <ChevronLeft aria-hidden className="size-6" />
                  </button>
                  <button
                    type="button"
                    onClick={() => step(1)}
                    aria-label="Next photo"
                    className="absolute top-1/2 right-3 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 hover:bg-white/20"
                  >
                    <ChevronRight aria-hidden className="size-6" />
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

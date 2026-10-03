'use client';

import type { CmsImage } from '@havenhub/shared';
import { Button, Textarea, cn } from '@havenhub/ui';
import { ImagePlus } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { Markdown } from '@/components/cms/markdown';

import { MediaPicker } from './media-picker';

/**
 * Markdown source with a live preview rendered by exactly the same safe
 * renderer the public site uses. Images are inserted from the media library.
 */
export function MarkdownEditor({
  label,
  name,
  value,
  onChange,
  mediaBase,
  maxLength,
  rows = 14,
  error,
  hint,
  canUpload,
  disabled,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  mediaBase: string;
  maxLength: number;
  rows?: number;
  error?: string;
  hint?: string;
  canUpload: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [picking, setPicking] = useState(false);

  function insert(image: CmsImage) {
    const el = area.current;
    const snippet = `![${(image.altText ?? '').replace(/[[\]]/g, '')}](${image.url})`;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const before = value.slice(0, start);
    const pad = before && !before.endsWith('\n') ? '\n\n' : '';
    onChange(`${before}${pad}${snippet}\n\n${value.slice(end)}`);
    setTab('write');
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-text">
          {label}
        </label>
        <div className="flex items-center gap-1" role="tablist" aria-label={`${label} editor`}>
          {(['write', 'preview'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className="rounded-full px-3 py-1 text-xs font-medium text-text-secondary aria-selected:bg-surface-inverse aria-selected:text-text-inverse"
            >
              {t === 'write' ? 'Write' : 'Preview'}
            </button>
          ))}
          {!disabled && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setPicking(true)}>
              <ImagePlus aria-hidden className="size-4" /> Image
            </Button>
          )}
        </div>
      </div>
      <div className={cn(tab !== 'write' && 'hidden')}>
        <Textarea
          ref={area}
          id={id}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          maxLength={maxLength}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-hint`}
          className="font-mono text-sm"
        />
      </div>
      {tab === 'preview' && (
        <div
          className="min-h-40 rounded-control border border-border bg-surface p-4"
          aria-live="polite"
        >
          {value.trim() ? (
            <Markdown source={value} mediaBase={mediaBase} />
          ) : (
            <p className="text-sm text-text-muted">Nothing to preview yet.</p>
          )}
        </div>
      )}
      <p
        id={`${id}-hint`}
        className={cn('text-xs', error ? 'font-medium text-error' : 'text-text-muted')}
      >
        {error ??
          hint ??
          'Markdown: ## heading, **bold**, *italic*, [link](https://…), - list. HTML is not allowed.'}{' '}
        {!error && (
          <span className="tabular-nums">
            {value.length.toLocaleString()} / {maxLength.toLocaleString()}
          </span>
        )}
      </p>
      <MediaPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={insert}
        canUpload={canUpload}
      />
    </div>
  );
}

'use client';

import type { AdminTestimonialView, CmsImage } from '@havenhub/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Textarea,
} from '@havenhub/ui';
import { Pencil, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api/client';
import { fieldErrors as toFieldErrors } from '@/lib/api/errors';
import type { ApiError } from '@havenhub/shared';

import { ImageField } from './image-field';

/** Quotes for the homepage Testimonials section (only published ones show). */
export function TestimonialsManager({
  items,
  canUpload,
}: {
  items: AdminTestimonialView[];
  canUpload: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<AdminTestimonialView | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(t: AdminTestimonialView) {
    if (!window.confirm(`Delete the testimonial from ${t.authorName}?`)) return;
    const res = await api('DELETE', `/admin/cms/testimonials/${t.id}`);
    if (!res.success) setError(res.message);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader
        title="Testimonials"
        description="Shown by the Testimonials section when it is switched on."
      />
      <CardBody className="flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}
        {items.length === 0 && <p className="text-sm text-text-secondary">No testimonials yet.</p>}
        <ul className="flex flex-col gap-3">
          {items.map((t) => (
            <li
              key={t.id}
              className="flex items-start justify-between gap-3 rounded-control border border-border p-4"
            >
              <div className="min-w-0">
                <p className="text-sm break-words text-text">“{t.quote}”</p>
                <p className="mt-1 text-xs text-text-secondary">
                  {t.authorName}
                  {t.authorRole ? ` · ${t.authorRole}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Badge tone={t.published ? 'success' : 'neutral'}>
                  {t.published ? 'Published' : 'Hidden'}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Edit testimonial from ${t.authorName}`}
                  onClick={() => setEditing(t)}
                >
                  <Pencil aria-hidden className="size-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete testimonial from ${t.authorName}`}
                  onClick={() => void remove(t)}
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {editing ? (
          <TestimonialForm
            key={editing === 'new' ? 'new' : editing.id}
            item={editing === 'new' ? null : editing}
            canUpload={canUpload}
            onDone={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        ) : (
          <Button variant="secondary" className="self-start" onClick={() => setEditing('new')}>
            Add testimonial
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

function TestimonialForm({
  item,
  canUpload,
  onDone,
}: {
  item: AdminTestimonialView | null;
  canUpload: boolean;
  onDone: () => void;
}) {
  const [quote, setQuote] = useState(item?.quote ?? '');
  const [authorName, setAuthorName] = useState(item?.authorName ?? '');
  const [authorRole, setAuthorRole] = useState(item?.authorRole ?? '');
  const [photo, setPhoto] = useState<CmsImage | null>(item?.photo ?? null);
  const [published, setPublished] = useState(item?.published ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const errors = toFieldErrors(error);

  async function save() {
    setBusy(true);
    const body = { quote, authorName, authorRole, photoId: photo?.id ?? null, published };
    const res = item
      ? await api('PATCH', `/admin/cms/testimonials/${item.id}`, body)
      : await api('POST', '/admin/cms/testimonials', body);
    setBusy(false);
    if (res.success) onDone();
    else setError(res);
  }

  return (
    <div className="flex flex-col gap-4 rounded-control border border-border p-4">
      <Field label="Quote" error={errors.quote}>
        {(a) => (
          <Textarea
            {...a}
            value={quote}
            onChange={(e) => setQuote(e.target.value)}
            rows={3}
            maxLength={600}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={errors.authorName}>
          {(a) => (
            <Input
              {...a}
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              maxLength={120}
            />
          )}
        </Field>
        <Field label="Role or place" optional error={errors.authorRole}>
          {(a) => (
            <Input
              {...a}
              value={authorRole}
              onChange={(e) => setAuthorRole(e.target.value)}
              maxLength={120}
            />
          )}
        </Field>
      </div>
      <ImageField
        label="Photo (optional)"
        value={photo}
        onChange={setPhoto}
        canUpload={canUpload}
      />
      <label className="flex items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          checked={published}
          onChange={(e) => setPublished(e.target.checked)}
          className="size-4 accent-primary"
        />
        Published
      </label>
      {error && error.code !== 'VALIDATION_ERROR' && <Alert tone="error">{error.message}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button loading={busy} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </div>
  );
}

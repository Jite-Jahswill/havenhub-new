'use client';

import {
  CMS_LIMITS,
  type AdminFaqView,
  type ApiError,
  type HelpCategoryView,
} from '@havenhub/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
} from '@havenhub/ui';
import { Pencil, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api/client';
import { fieldErrors as toFieldErrors } from '@/lib/api/errors';

import { MarkdownEditor } from './markdown-editor';

export function FaqManager({
  faqs,
  categories,
  mediaBase,
  canUpload,
}: {
  faqs: AdminFaqView[];
  categories: HelpCategoryView[];
  mediaBase: string;
  canUpload: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<AdminFaqView | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title="FAQs" description="Published FAQs appear in the help centre." />
      <CardBody className="flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}
        {faqs.length === 0 && <p className="text-sm text-text-secondary">No FAQs yet.</p>}
        <ul className="flex flex-col gap-2">
          {faqs.map((f) => (
            <li
              key={f.id}
              className="flex items-start justify-between gap-3 rounded-control border border-border px-4 py-3"
            >
              <span className="min-w-0">
                <span className="block font-medium break-words text-text">{f.question}</span>
                <span className="text-xs text-text-muted">{f.category?.name ?? 'General'}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <Badge tone={f.published ? 'success' : 'neutral'}>
                  {f.published ? 'Published' : 'Hidden'}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Edit FAQ: ${f.question}`}
                  onClick={() => setEditing(f)}
                >
                  <Pencil aria-hidden className="size-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete FAQ: ${f.question}`}
                  onClick={async () => {
                    if (!window.confirm('Delete this FAQ?')) return;
                    const res = await api('DELETE', `/admin/help/faqs/${f.id}`);
                    if (!res.success) setError(res.message);
                    router.refresh();
                  }}
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
        {editing ? (
          <FaqForm
            key={editing === 'new' ? 'new' : editing.id}
            faq={editing === 'new' ? null : editing}
            categories={categories}
            mediaBase={mediaBase}
            canUpload={canUpload}
            onDone={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        ) : (
          <Button variant="secondary" className="self-start" onClick={() => setEditing('new')}>
            Add FAQ
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

function FaqForm({
  faq,
  categories,
  mediaBase,
  canUpload,
  onDone,
}: {
  faq: AdminFaqView | null;
  categories: HelpCategoryView[];
  mediaBase: string;
  canUpload: boolean;
  onDone: () => void;
}) {
  const [question, setQuestion] = useState(faq?.question ?? '');
  const [answer, setAnswer] = useState(faq?.answer ?? '');
  const [categoryId, setCategoryId] = useState(faq?.categoryId ?? '');
  const [published, setPublished] = useState(faq?.published ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const errors = toFieldErrors(error);

  async function save() {
    setBusy(true);
    const body = { question, answer, categoryId: categoryId || null, published };
    const res = faq
      ? await api('PATCH', `/admin/help/faqs/${faq.id}`, body)
      : await api('POST', '/admin/help/faqs', body);
    setBusy(false);
    if (res.success) onDone();
    else setError(res);
  }

  return (
    <div className="flex flex-col gap-4 rounded-control border border-border p-4">
      <Field label="Question" error={errors.question}>
        {(a) => (
          <Input
            {...a}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={300}
          />
        )}
      </Field>
      <MarkdownEditor
        label="Answer"
        name="answer"
        value={answer}
        onChange={setAnswer}
        mediaBase={mediaBase}
        maxLength={CMS_LIMITS.faqAnswer}
        rows={5}
        error={errors.answer}
        canUpload={canUpload}
      />
      <Field label="Category" optional>
        {(a) => (
          <Select {...a} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">General</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
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

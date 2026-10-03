'use client';

import {
  CMS_LIMITS,
  type AdminHelpArticleView,
  type ApiError,
  type ContentStatus,
  type HelpCategoryView,
} from '@havenhub/shared';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
  buttonClasses,
} from '@havenhub/ui';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api/client';
import { fieldErrors as toFieldErrors } from '@/lib/api/errors';

import { ContentStatusBadge } from './content-status';
import { MarkdownEditor } from './markdown-editor';
import { SeoFields, type SeoValue } from './seo-fields';

export function ArticleEditor({
  article,
  categories,
  mediaBase,
  canUpload,
}: {
  article: AdminHelpArticleView | null;
  categories: HelpCategoryView[];
  mediaBase: string;
  canUpload: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(article?.title ?? '');
  const [slug, setSlug] = useState(article?.slug ?? '');
  const [summary, setSummary] = useState(article?.summary ?? '');
  const [body, setBody] = useState(article?.body ?? '');
  const [categoryId, setCategoryId] = useState(article?.categoryId ?? categories[0]?.id ?? '');
  const [sortOrder, setSortOrder] = useState(String(article?.sortOrder ?? 0));
  const [seo, setSeo] = useState<SeoValue>({
    seoTitle: article?.seoTitle ?? '',
    seoDescription: article?.seoDescription ?? '',
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const errors = toFieldErrors(error);

  async function save() {
    setBusy('save');
    setError(null);
    setNotice(null);
    const body_ = {
      title,
      ...(slug && slug !== article?.slug ? { slug } : {}),
      summary,
      body,
      categoryId,
      sortOrder: Number(sortOrder) || 0,
      seoTitle: seo.seoTitle,
      seoDescription: seo.seoDescription,
    };
    const res = article
      ? await api<AdminHelpArticleView>('PATCH', `/admin/help/articles/${article.id}`, body_)
      : await api<AdminHelpArticleView>('POST', '/admin/help/articles', body_);
    setBusy(null);
    if (!res.success) return setError(res);
    if (!article) router.push(`/admin/help/articles/${res.data.id}`);
    else {
      setNotice('Saved.');
      router.refresh();
    }
  }

  async function status(next: ContentStatus) {
    if (!article) return;
    setBusy(next);
    setError(null);
    const res = await api('POST', `/admin/help/articles/${article.id}/status`, { status: next });
    setBusy(null);
    if (!res.success) return setError(res);
    setNotice('Updated.');
    router.refresh();
  }

  if (!categories.length) {
    return (
      <Alert>
        Create a help category first.{' '}
        <Link href="/admin/help" className="font-semibold underline">
          Back to the help centre
        </Link>
      </Alert>
    );
  }
  const dirty = article && body !== article.body;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardBody className="flex flex-col gap-5">
            <Field label="Title" error={errors.title}>
              {(a) => (
                <Input
                  {...a}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={160}
                />
              )}
            </Field>
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Category" error={errors.categoryId} className="sm:col-span-2">
                {(a) => (
                  <Select {...a} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Order" optional error={errors.sortOrder}>
                {(a) => (
                  <Input
                    {...a}
                    type="number"
                    min={0}
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Field label="Address" optional error={errors.slug}>
              {(a) => (
                <Input
                  {...a}
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  maxLength={160}
                />
              )}
            </Field>
            <Field label="Summary" optional error={errors.summary}>
              {(a) => (
                <Input
                  {...a}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  maxLength={300}
                />
              )}
            </Field>
            <MarkdownEditor
              label="Article"
              name="body"
              value={body}
              onChange={setBody}
              mediaBase={mediaBase}
              maxLength={CMS_LIMITS.helpBody}
              error={errors.body}
              canUpload={canUpload}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Search" />
          <CardBody>
            <SeoFields value={seo} onChange={setSeo} errors={errors} canUpload={canUpload} />
          </CardBody>
        </Card>
      </div>
      <aside className="flex flex-col gap-3 xl:sticky xl:top-26 xl:self-start">
        <Card>
          <CardBody className="flex flex-col gap-3">
            {article && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-text">Status</span>
                <ContentStatusBadge status={article.status} />
              </div>
            )}
            {error && error.code !== 'VALIDATION_ERROR' && (
              <Alert tone="error">{error.message}</Alert>
            )}
            {error?.code === 'VALIDATION_ERROR' && (
              <Alert tone="error">{errors.body ?? 'Please fix the highlighted fields.'}</Alert>
            )}
            {notice && <Alert tone="success">{notice}</Alert>}
            <Button onClick={() => void save()} loading={busy === 'save'}>
              {article ? 'Save changes' : 'Create draft'}
            </Button>
            {article?.status === 'DRAFT' && (
              <Button
                variant="secondary"
                disabled={Boolean(dirty)}
                loading={busy === 'PUBLISHED'}
                onClick={() => void status('PUBLISHED')}
              >
                Publish
              </Button>
            )}
            {article?.status === 'PUBLISHED' && (
              <>
                <Link
                  href={`/help/${article.slug}`}
                  target="_blank"
                  className={buttonClasses({ variant: 'secondary' })}
                >
                  View article <ExternalLink aria-hidden className="size-4" />
                </Link>
                <Button
                  variant="ghost"
                  loading={busy === 'DRAFT'}
                  onClick={() => void status('DRAFT')}
                >
                  Unpublish
                </Button>
              </>
            )}
            {article && article.status !== 'ARCHIVED' && (
              <Button
                variant="ghost"
                loading={busy === 'ARCHIVED'}
                onClick={() => void status('ARCHIVED')}
              >
                Archive
              </Button>
            )}
            {article?.status === 'ARCHIVED' && (
              <Button
                variant="secondary"
                loading={busy === 'DRAFT'}
                onClick={() => void status('DRAFT')}
              >
                Restore as draft
              </Button>
            )}
            {article && article.status !== 'PUBLISHED' && (
              <Button
                variant="danger"
                loading={busy === 'delete'}
                onClick={async () => {
                  if (!window.confirm(`Delete “${article.title}” permanently?`)) return;
                  setBusy('delete');
                  const res = await api('DELETE', `/admin/help/articles/${article.id}`);
                  setBusy(null);
                  if (res.success) router.push('/admin/help');
                  else setError(res);
                }}
              >
                Delete permanently
              </Button>
            )}
          </CardBody>
        </Card>
      </aside>
    </div>
  );
}

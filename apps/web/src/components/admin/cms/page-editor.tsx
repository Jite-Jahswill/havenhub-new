'use client';

import {
  CMS_LIMITS,
  type AdminPageView,
  type ApiError,
  type ContentStatus,
} from '@havenhub/shared';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
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

/** Create or edit a page. Built-in pages keep their address and cannot be deleted. */
export function PageEditor({
  page,
  mediaBase,
  canUpload,
}: {
  page: AdminPageView | null;
  mediaBase: string;
  canUpload: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(page?.title ?? '');
  const [slug, setSlug] = useState(page?.slug ?? '');
  const [body, setBody] = useState(page?.body ?? '');
  const [seo, setSeo] = useState<SeoValue>({
    seoTitle: page?.seoTitle ?? '',
    seoDescription: page?.seoDescription ?? '',
    ogImage: page?.ogImage ?? null,
    noIndex: page?.noIndex ?? false,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const errors = toFieldErrors(error);

  const payload = () => ({
    title,
    ...(slug && slug !== page?.slug ? { slug } : {}),
    body,
    seoTitle: seo.seoTitle,
    seoDescription: seo.seoDescription,
    ogImageId: seo.ogImage?.id ?? null,
    noIndex: Boolean(seo.noIndex),
  });

  async function save() {
    setBusy('save');
    setError(null);
    setNotice(null);
    const res = page
      ? await api<AdminPageView>('PATCH', `/admin/cms/pages/${page.id}`, payload())
      : await api<AdminPageView>('POST', '/admin/cms/pages', payload());
    setBusy(null);
    if (!res.success) return setError(res);
    if (!page) router.push(`/admin/pages/${res.data.id}`);
    else {
      setNotice('Saved.');
      router.refresh();
    }
  }

  async function status(next: ContentStatus) {
    if (!page) return;
    setBusy(next);
    setError(null);
    const res = await api('POST', `/admin/cms/pages/${page.id}/status`, { status: next });
    setBusy(null);
    if (!res.success) return setError(res);
    setNotice(
      next === 'PUBLISHED' ? 'Published.' : next === 'ARCHIVED' ? 'Archived.' : 'Moved to drafts.',
    );
    router.refresh();
  }

  async function remove() {
    if (!page || !window.confirm(`Delete “${page.title}” permanently?`)) return;
    setBusy('delete');
    const res = await api('DELETE', `/admin/cms/pages/${page.id}`);
    setBusy(null);
    if (!res.success) return setError(res);
    router.push('/admin/pages');
  }

  const dirty = page && (title !== page.title || body !== page.body);
  const path = page ? (page.system ? `/${page.slug}` : `/pages/${page.slug}`) : null;

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
            <Field
              label="Address"
              optional={!page}
              hint={
                page?.system
                  ? 'Built-in pages keep their address.'
                  : 'Lowercase letters, numbers and hyphens. Leave empty to use the title.'
              }
              error={errors.slug}
            >
              {(a) => (
                <Input
                  {...a}
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  disabled={page?.system}
                  maxLength={80}
                  placeholder="our-story"
                />
              )}
            </Field>
            <MarkdownEditor
              label="Content"
              name="body"
              value={body}
              onChange={setBody}
              mediaBase={mediaBase}
              maxLength={CMS_LIMITS.pageBody}
              error={errors.body}
              canUpload={canUpload}
              hint={
                page?.system && ['terms', 'privacy'].includes(page.slug)
                  ? 'Paste the text approved by your legal adviser. Nothing is published until you publish it.'
                  : undefined
              }
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Search & sharing" />
          <CardBody>
            <SeoFields
              value={seo}
              onChange={setSeo}
              errors={errors}
              canUpload={canUpload}
              withImage
              withNoIndex
            />
          </CardBody>
        </Card>
      </div>
      <aside className="flex flex-col gap-4 xl:sticky xl:top-26 xl:self-start">
        <Card>
          <CardBody className="flex flex-col gap-3">
            {page && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-text">Status</span>
                <ContentStatusBadge status={page.status} />
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
              {page ? 'Save changes' : 'Create draft'}
            </Button>
            {page && page.status !== 'PUBLISHED' && page.status !== 'ARCHIVED' && (
              <Button
                variant="secondary"
                disabled={Boolean(dirty)}
                loading={busy === 'PUBLISHED'}
                onClick={() => void status('PUBLISHED')}
              >
                Publish
              </Button>
            )}
            {dirty && page?.status !== 'PUBLISHED' && (
              <p className="text-xs text-text-muted">Save your changes before publishing.</p>
            )}
            {page?.status === 'PUBLISHED' && (
              <>
                {path && (
                  <Link
                    href={path}
                    target="_blank"
                    className={buttonClasses({ variant: 'secondary' })}
                  >
                    View page <ExternalLink aria-hidden className="size-4" />
                  </Link>
                )}
                <Button
                  variant="ghost"
                  loading={busy === 'DRAFT'}
                  onClick={() => void status('DRAFT')}
                >
                  Unpublish
                </Button>
              </>
            )}
            {page && page.status !== 'ARCHIVED' && (
              <Button
                variant="ghost"
                loading={busy === 'ARCHIVED'}
                onClick={() => void status('ARCHIVED')}
              >
                Archive
              </Button>
            )}
            {page?.status === 'ARCHIVED' && (
              <Button
                variant="secondary"
                loading={busy === 'DRAFT'}
                onClick={() => void status('DRAFT')}
              >
                Restore as draft
              </Button>
            )}
            {page && !page.system && page.status !== 'PUBLISHED' && (
              <Button variant="danger" loading={busy === 'delete'} onClick={() => void remove()}>
                Delete permanently
              </Button>
            )}
          </CardBody>
        </Card>
      </aside>
    </div>
  );
}

'use client';

import {
  CMS_LIMITS,
  type AdminPostListItem,
  type AdminPostView,
  type ApiError,
  type ApiResponse,
  type BlogCategoryView,
  type BlogTagView,
  type CmsImage,
  type Paginated,
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
  Textarea,
  buttonClasses,
} from '@havenhub/ui';
import { ExternalLink, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api/client';
import { fieldErrors as toFieldErrors } from '@/lib/api/errors';
import { formatMoment } from '@/lib/format';

import { ContentStatusBadge } from './content-status';
import { ImageField } from './image-field';
import { MarkdownEditor } from './markdown-editor';
import { SeoFields, type SeoValue } from './seo-fields';

export interface BlogPermissions {
  create: boolean;
  edit: boolean;
  publish: boolean;
  remove: boolean;
  upload: boolean;
}

/** Lagos wall time (UTC+1, no DST) → ISO, independent of the browser's timezone. */
const fromLagos = (v: string) => (v ? `${v}:00+01:00` : undefined);

export function PostEditor({
  post,
  categories,
  tags,
  mediaBase,
  can,
}: {
  post: AdminPostView | null;
  categories: BlogCategoryView[];
  tags: BlogTagView[];
  mediaBase: string;
  can: BlogPermissions;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(post?.title ?? '');
  const [slug, setSlug] = useState(post?.slug ?? '');
  const [excerpt, setExcerpt] = useState(post?.excerpt ?? '');
  const [body, setBody] = useState(post?.body ?? '');
  const [cover, setCover] = useState<CmsImage | null>(post?.coverImage ?? null);
  const [categoryId, setCategoryId] = useState(post?.category?.id ?? '');
  const [tagIds, setTagIds] = useState<string[]>(post?.tags.map((t) => t.id) ?? []);
  const [related, setRelated] = useState(post?.related ?? []);
  const [authorName, setAuthorName] = useState(post?.authorName ?? '');
  const [canonicalUrl, setCanonicalUrl] = useState(post?.canonicalUrl ?? '');
  const [keywords, setKeywords] = useState(post?.seoKeywords.join(', ') ?? '');
  const [seo, setSeo] = useState<SeoValue>({
    seoTitle: post?.seoTitle ?? '',
    seoDescription: post?.seoDescription ?? '',
    noIndex: post?.noIndex ?? false,
  });
  const [when, setWhen] = useState('');
  const [relatedQuery, setRelatedQuery] = useState('');
  const [relatedResults, setRelatedResults] = useState<AdminPostListItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const errors = toFieldErrors(error);
  const live = post?.status === 'PUBLISHED';
  const editable = post ? can.edit && (!live || can.publish) : can.create;

  const payload = () => ({
    title,
    ...(slug && slug !== post?.slug ? { slug } : {}),
    excerpt,
    body,
    coverImageId: cover?.id ?? null,
    categoryId: categoryId || null,
    tagIds,
    relatedIds: related.map((r) => r.id),
    authorName,
    seoTitle: seo.seoTitle,
    seoDescription: seo.seoDescription,
    seoKeywords: keywords
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
    canonicalUrl,
    noIndex: Boolean(seo.noIndex),
  });

  async function call(key: string, fn: () => Promise<ApiResponse<unknown>>, done: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    const res = await fn();
    setBusy(null);
    if (!res.success) {
      setError(res);
      return false;
    }
    setNotice(done);
    router.refresh();
    return true;
  }

  async function save() {
    if (!post) {
      setBusy('save');
      setError(null);
      const res = await api<AdminPostView>('POST', '/admin/blog/posts', payload());
      setBusy(null);
      if (!res.success) return setError(res);
      router.push(`/admin/blog/${res.data.id}`);
      return;
    }
    await call(
      'save',
      () => api('PATCH', `/admin/blog/posts/${post.id}`, payload()),
      live ? 'Saved — the live post is updated.' : 'Saved.',
    );
  }

  async function findRelated() {
    const q = relatedQuery.trim();
    if (!q) return;
    const res = await api<Paginated<AdminPostListItem>>(
      'GET',
      `/admin/blog/posts?search=${encodeURIComponent(q)}&pageSize=8`,
    );
    if (res.success) setRelatedResults(res.data.items.filter((p) => p.id !== post?.id));
  }

  const dirty = post && (body !== post.body || title !== post.title);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <fieldset disabled={!editable} className="flex min-w-0 flex-col gap-6">
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
              optional
              hint="Leave empty to use the title."
              error={errors.slug}
            >
              {(a) => (
                <Input
                  {...a}
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  maxLength={160}
                />
              )}
            </Field>
            <Field
              label="Excerpt"
              optional
              hint="Shown on cards and at the top of the post."
              error={errors.excerpt}
            >
              {(a) => (
                <Textarea
                  {...a}
                  rows={2}
                  value={excerpt}
                  onChange={(e) => setExcerpt(e.target.value)}
                  maxLength={400}
                />
              )}
            </Field>
            <MarkdownEditor
              label="Article"
              name="body"
              value={body}
              onChange={setBody}
              mediaBase={mediaBase}
              maxLength={CMS_LIMITS.postBody}
              rows={18}
              error={errors.body}
              canUpload={can.upload}
              disabled={!editable}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Organisation" />
          <CardBody className="flex flex-col gap-5">
            <ImageField
              label="Featured image"
              value={cover}
              onChange={setCover}
              canUpload={can.upload}
              disabled={!editable}
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Category" optional error={errors.categoryId}>
                {(a) => (
                  <Select {...a} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                    <option value="">None</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                label="Author name"
                optional
                hint="Defaults to your name."
                error={errors.authorName}
              >
                {(a) => (
                  <Input
                    {...a}
                    value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                    maxLength={120}
                  />
                )}
              </Field>
            </div>
            {tags.length > 0 && (
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-text">Tags</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {tags.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 text-sm text-text">
                      <input
                        type="checkbox"
                        checked={tagIds.includes(t.id)}
                        onChange={(e) =>
                          setTagIds((l) =>
                            e.target.checked ? [...l, t.id] : l.filter((x) => x !== t.id),
                          )
                        }
                        className="size-4 accent-primary"
                      />
                      {t.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-text">Related posts</span>
              {related.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {related.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center gap-1 rounded-full border border-border py-1 pr-1 pl-3 text-sm"
                    >
                      {r.title}
                      <button
                        type="button"
                        aria-label={`Remove ${r.title}`}
                        onClick={() => setRelated((l) => l.filter((x) => x.id !== r.id))}
                        className="grid size-6 place-items-center rounded-full hover:bg-surface-secondary"
                      >
                        <X aria-hidden className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {related.length < CMS_LIMITS.relatedPerPost && (
                <div className="flex gap-2">
                  <Input
                    aria-label="Find a post to relate"
                    placeholder="Find a post"
                    value={relatedQuery}
                    onChange={(e) => setRelatedQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void findRelated();
                      }
                    }}
                  />
                  <Button type="button" variant="secondary" onClick={() => void findRelated()}>
                    Find
                  </Button>
                </div>
              )}
              {relatedResults.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {relatedResults.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={related.some((r) => r.id === p.id)}
                        onClick={() => {
                          setRelated((l) => [...l, { id: p.id, title: p.title, slug: p.slug }]);
                          setRelatedResults([]);
                          setRelatedQuery('');
                        }}
                        className="w-full rounded-control px-3 py-2 text-left text-sm hover:bg-surface-secondary disabled:opacity-50"
                      >
                        {p.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {errors.relatedIds && (
                <p className="text-xs font-medium text-error">{errors.relatedIds}</p>
              )}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Search & sharing" />
          <CardBody className="flex flex-col gap-4">
            <SeoFields
              value={seo}
              onChange={setSeo}
              errors={errors}
              canUpload={can.upload}
              withNoIndex
            />
            <Field label="Keywords" optional hint="Comma separated." error={errors.seoKeywords}>
              {(a) => (
                <Input {...a} value={keywords} onChange={(e) => setKeywords(e.target.value)} />
              )}
            </Field>
            <Field
              label="Canonical URL"
              optional
              hint="Only if this article was first published elsewhere (https://…)."
              error={errors.canonicalUrl}
            >
              {(a) => (
                <Input
                  {...a}
                  value={canonicalUrl}
                  onChange={(e) => setCanonicalUrl(e.target.value)}
                  maxLength={500}
                />
              )}
            </Field>
          </CardBody>
        </Card>
      </fieldset>

      <aside className="flex flex-col gap-4 xl:sticky xl:top-26 xl:self-start">
        <Card>
          <CardBody className="flex flex-col gap-3">
            {post && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-text">Status</span>
                <ContentStatusBadge status={post.displayStatus} />
              </div>
            )}
            {post?.publishAt && post.status === 'PUBLISHED' && (
              <p className="text-sm text-text-secondary">
                {post.displayStatus === 'SCHEDULED' ? 'Goes live' : 'Published'}{' '}
                {formatMoment(post.publishAt)}
              </p>
            )}
            {!editable && post && (
              <Alert>
                You can view this post but not change it{live ? ' while it is live' : ''}.
              </Alert>
            )}
            {error && error.code !== 'VALIDATION_ERROR' && (
              <Alert tone="error">{error.message}</Alert>
            )}
            {error?.code === 'VALIDATION_ERROR' && (
              <Alert tone="error">Please fix the highlighted fields.</Alert>
            )}
            {notice && <Alert tone="success">{notice}</Alert>}
            {editable && (
              <Button onClick={() => void save()} loading={busy === 'save'}>
                {post ? 'Save changes' : 'Create draft'}
              </Button>
            )}
            {post && can.publish && post.status === 'DRAFT' && (
              <>
                <Button
                  variant="secondary"
                  disabled={Boolean(dirty)}
                  loading={busy === 'publish'}
                  onClick={() =>
                    void call(
                      'publish',
                      () => api('POST', `/admin/blog/posts/${post.id}/publish`, {}),
                      'Published.',
                    )
                  }
                >
                  Publish now
                </Button>
                <div className="flex flex-col gap-2 rounded-control border border-border p-3">
                  <Field label="Or schedule for (Lagos time)">
                    {(a) => (
                      <Input
                        {...a}
                        type="datetime-local"
                        value={when}
                        onChange={(e) => setWhen(e.target.value)}
                      />
                    )}
                  </Field>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!when || Boolean(dirty)}
                    loading={busy === 'schedule'}
                    onClick={() =>
                      void call(
                        'schedule',
                        () =>
                          api('POST', `/admin/blog/posts/${post.id}/publish`, {
                            publishAt: fromLagos(when),
                          }),
                        'Scheduled.',
                      )
                    }
                  >
                    Schedule
                  </Button>
                </div>
                {dirty && (
                  <p className="text-xs text-text-muted">Save your changes before publishing.</p>
                )}
              </>
            )}
            {post && post.status === 'PUBLISHED' && (
              <>
                {post.displayStatus === 'PUBLISHED' && (
                  <Link
                    href={`/blog/${post.slug}`}
                    target="_blank"
                    className={buttonClasses({ variant: 'secondary' })}
                  >
                    View post <ExternalLink aria-hidden className="size-4" />
                  </Link>
                )}
                {can.publish && (
                  <Button
                    variant="ghost"
                    loading={busy === 'unpublish'}
                    onClick={() =>
                      void call(
                        'unpublish',
                        () => api('POST', `/admin/blog/posts/${post.id}/unpublish`),
                        'Moved back to drafts.',
                      )
                    }
                  >
                    {post.displayStatus === 'SCHEDULED' ? 'Cancel schedule' : 'Unpublish'}
                  </Button>
                )}
              </>
            )}
            {post && can.remove && post.status !== 'ARCHIVED' && (
              <Button
                variant="ghost"
                loading={busy === 'archive'}
                onClick={() =>
                  void call(
                    'archive',
                    () => api('POST', `/admin/blog/posts/${post.id}/archive`),
                    'Archived.',
                  )
                }
              >
                Archive
              </Button>
            )}
            {post && can.remove && post.status === 'ARCHIVED' && (
              <Button
                variant="secondary"
                loading={busy === 'restore'}
                onClick={() =>
                  void call(
                    'restore',
                    () => api('POST', `/admin/blog/posts/${post.id}/restore`),
                    'Restored as a draft.',
                  )
                }
              >
                Restore as draft
              </Button>
            )}
            {post && can.remove && post.status !== 'PUBLISHED' && (
              <Button
                variant="danger"
                loading={busy === 'delete'}
                onClick={async () => {
                  if (!window.confirm(`Delete “${post.title}” permanently?`)) return;
                  setBusy('delete');
                  const res = await api('DELETE', `/admin/blog/posts/${post.id}`);
                  setBusy(null);
                  if (res.success) router.push('/admin/blog');
                  else setError(res);
                }}
              >
                Delete permanently
              </Button>
            )}
            {post && (
              <p className="text-xs text-text-muted">
                About {post.readingMinutes} min read · times are Lagos time
              </p>
            )}
          </CardBody>
        </Card>
      </aside>
    </div>
  );
}

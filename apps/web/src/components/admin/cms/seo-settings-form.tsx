'use client';

import {
  SITEMAP_SECTIONS,
  type AdminSeoSettingsView,
  type ApiError,
  type CmsImage,
  type SeoRouteView,
} from '@havenhub/shared';
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Textarea } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api/client';
import { fieldErrors as toFieldErrors } from '@/lib/api/errors';

import { ImageField } from './image-field';

const SECTION_LABELS: Record<string, string> = {
  properties: 'Properties',
  events: 'Events',
  tours: 'Tours',
  hotels: 'Hotels',
  cleaning: 'Cleaning',
  destinations: 'Destinations',
  blog: 'Blog posts',
  help: 'Help articles',
  careers: 'Jobs',
  pages: 'Pages',
};

export function SeoSettingsForm({
  seo,
  canUpload,
}: {
  seo: AdminSeoSettingsView;
  canUpload: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(seo.seoTitle ?? '');
  const [description, setDescription] = useState(seo.seoDescription ?? '');
  const [keywords, setKeywords] = useState(seo.seoKeywords.join(', '));
  const [og, setOg] = useState<CmsImage | null>(seo.ogImage);
  const [twitter, setTwitter] = useState(seo.twitterHandle ?? '');
  const [allow, setAllow] = useState(seo.allowIndexing);
  const [disallow, setDisallow] = useState(seo.robotsDisallow.join('\n'));
  const [sections, setSections] = useState<string[]>(seo.sitemapSections);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const errors = toFieldErrors(error);

  async function save() {
    setBusy(true);
    setSaved(false);
    setError(null);
    const res = await api('PATCH', '/admin/cms/seo', {
      seoTitle: title,
      seoDescription: description,
      seoKeywords: keywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
      ogImageId: og?.id ?? null,
      twitterHandle: twitter,
      allowIndexing: allow,
      robotsDisallow: disallow
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
      sitemapSections: sections,
    });
    setBusy(false);
    if (!res.success) return setError(res);
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Site defaults"
          description="Used wherever a page has no metadata of its own."
        />
        <CardBody className="flex flex-col gap-5">
          <Field label="Default title" optional error={errors.seoTitle}>
            {(a) => (
              <Input
                {...a}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={70}
              />
            )}
          </Field>
          <Field label="Default description" optional error={errors.seoDescription}>
            {(a) => (
              <Textarea
                {...a}
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={200}
              />
            )}
          </Field>
          <Field label="Keywords" optional hint="Comma separated." error={errors.seoKeywords}>
            {(a) => <Input {...a} value={keywords} onChange={(e) => setKeywords(e.target.value)} />}
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <ImageField
              label="Default sharing image"
              value={og}
              onChange={setOg}
              canUpload={canUpload}
            />
            <Field label="X (Twitter) handle" optional error={errors.twitterHandle}>
              {(a) => (
                <Input
                  {...a}
                  value={twitter}
                  onChange={(e) => setTwitter(e.target.value)}
                  placeholder="@havenhub"
                  maxLength={16}
                />
              )}
            </Field>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Robots & sitemap"
          description="Admin, agent, account and API areas are always excluded."
        />
        <CardBody className="flex flex-col gap-5">
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={allow}
              onChange={(e) => setAllow(e.target.checked)}
              className="size-4 accent-primary"
            />
            Allow search engines to index the site
          </label>
          <Field
            label="Also exclude these paths"
            optional
            hint="One per line, starting with /."
            error={
              errors.robotsDisallow ??
              Object.entries(errors).find(([k]) => k.startsWith('robotsDisallow'))?.[1]
            }
          >
            {(a) => (
              <Textarea
                {...a}
                rows={3}
                value={disallow}
                onChange={(e) => setDisallow(e.target.value)}
              />
            )}
          </Field>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-text">Include in sitemap.xml</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {SITEMAP_SECTIONS.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={sections.includes(s)}
                    onChange={(e) =>
                      setSections((l) => (e.target.checked ? [...l, s] : l.filter((x) => x !== s)))
                    }
                    className="size-4 accent-primary"
                  />
                  {SECTION_LABELS[s]}
                </label>
              ))}
            </div>
          </fieldset>
        </CardBody>
      </Card>
      {error && error.code !== 'VALIDATION_ERROR' && <Alert tone="error">{error.message}</Alert>}
      {error?.code === 'VALIDATION_ERROR' && (
        <Alert tone="error">Please fix the highlighted fields.</Alert>
      )}
      {saved && <Alert tone="success">Saved.</Alert>}
      <Button className="self-end" loading={busy} onClick={() => void save()}>
        Save SEO settings
      </Button>
    </div>
  );
}

export function SeoRoutes({ routes, canUpload }: { routes: SeoRouteView[]; canUpload: boolean }) {
  return (
    <Card>
      <CardHeader
        title="Page overrides"
        description="Metadata for fixed pages. Listings, posts and pages have their own fields."
      />
      <CardBody>
        <ul className="divide-y divide-border">
          {routes.map((r) => (
            <RouteRow key={r.path} route={r} canUpload={canUpload} />
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function RouteRow({ route, canUpload }: { route: SeoRouteView; canUpload: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(route.title ?? '');
  const [description, setDescription] = useState(route.description ?? '');
  const [og, setOg] = useState<CmsImage | null>(route.ogImage);
  const [noIndex, setNoIndex] = useState(route.noIndex);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="font-mono text-sm text-text">{route.path}</span>
          <span className="block truncate text-xs text-text-muted">
            {route.title ?? 'Default'}
            {route.noIndex ? ' · noindex' : ''}
          </span>
        </span>
        <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : 'Edit'}
        </Button>
      </div>
      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <Input
            aria-label="Title"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={70}
          />
          <Textarea
            aria-label="Description"
            placeholder="Description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={200}
          />
          <ImageField label="Sharing image" value={og} onChange={setOg} canUpload={canUpload} />
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={noIndex}
              onChange={(e) => setNoIndex(e.target.checked)}
              className="size-4 accent-primary"
            />
            Hide from search engines
          </label>
          {error && <Alert tone="error">{error}</Alert>}
          <Button
            size="sm"
            className="self-end"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const res = await api('PUT', '/admin/cms/seo/routes', {
                path: route.path,
                title,
                description,
                ogImageId: og?.id ?? null,
                noIndex,
              });
              setBusy(false);
              if (!res.success) setError(res.message);
              else {
                setOpen(false);
                router.refresh();
              }
            }}
          >
            Save
          </Button>
        </div>
      )}
    </li>
  );
}

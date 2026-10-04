import type { BlogCategoryView, BlogPostList } from '@havenhub/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BlogList } from '@/components/cms/blog-list';
import { cmsApi, cmsData, getSite, routeMetadata } from '@/lib/cms';
import { env } from '@/lib/env';

export function generateMetadata(): Promise<Metadata> {
  return routeMetadata('/blog', {
    title: 'Blog',
    description: 'Guides and news about renting, buying and exploring Nigeria.',
    alternates: { canonical: `${env.NEXT_PUBLIC_SITE_URL}/blog` },
  });
}

const str = (v: string | string[] | undefined) =>
  typeof v === 'string' && v ? v.slice(0, 100) : undefined;

export default async function BlogPage({ searchParams }: PageProps<'/blog'>) {
  const site = await getSite();
  if (!site.features.blog) notFound();
  const sp = await searchParams;
  const q = str(sp.q);
  const page = str(sp.page);
  const params = new URLSearchParams({
    ...(q ? { q } : {}),
    ...(page && /^\d{1,4}$/.test(page) ? { page } : {}),
  });
  const [res, categories] = await Promise.all([
    // A search is visitor input: forward the visitor's signed IP for per-IP limits.
    cmsApi<BlogPostList>(`/blog/posts?${params}`, { visitor: Boolean(q) }),
    cmsData<BlogCategoryView[]>('/blog/categories'),
  ]);
  return (
    <BlogList
      heading="Blog"
      intro="Guides and news about renting, buying and exploring Nigeria."
      result={res.success ? res.data : null}
      categories={categories ?? []}
      basePath="/blog"
      q={q}
    />
  );
}

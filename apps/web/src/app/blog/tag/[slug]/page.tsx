import type { BlogCategoryView, BlogPostList } from '@havenhub/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BlogList } from '@/components/cms/blog-list';
import { cmsData, getSite } from '@/lib/cms';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const getTag = async (slug: string) =>
  SLUG.test(slug) ? cmsData<{ slug: string; name: string }>(`/blog/tags/${slug}`) : null;

export async function generateMetadata({
  params,
}: PageProps<'/blog/tag/[slug]'>): Promise<Metadata> {
  const tag = await getTag((await params).slug);
  return tag
    ? { title: `#${tag.name} · Blog`, robots: { index: false, follow: true } }
    : { title: 'Not found' };
}

export default async function BlogTagPage({ params, searchParams }: PageProps<'/blog/tag/[slug]'>) {
  if (!(await getSite()).features.blog) notFound();
  const tag = await getTag((await params).slug);
  if (!tag) notFound();
  const page = (await searchParams).page;
  const p = typeof page === 'string' && /^\d{1,4}$/.test(page) ? page : '1';
  const [result, categories] = await Promise.all([
    cmsData<BlogPostList>(`/blog/posts?tag=${tag.slug}&page=${p}`),
    cmsData<BlogCategoryView[]>('/blog/categories'),
  ]);
  return (
    <BlogList
      heading={`#${tag.name}`}
      result={result}
      categories={categories ?? []}
      basePath={`/blog/tag/${tag.slug}`}
    />
  );
}

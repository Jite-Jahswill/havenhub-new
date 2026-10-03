import type { BlogCategoryView, BlogPostList } from '@havenhub/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BlogList } from '@/components/cms/blog-list';
import { cmsData, getSite } from '@/lib/cms';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function load(slug: string) {
  if (!SLUG.test(slug)) return null;
  const categories = (await cmsData<BlogCategoryView[]>('/blog/categories')) ?? [];
  const category = categories.find((c) => c.slug === slug);
  return category ? { category, categories } : null;
}

export async function generateMetadata({
  params,
}: PageProps<'/blog/category/[slug]'>): Promise<Metadata> {
  const data = await load((await params).slug);
  return data
    ? { title: `${data.category.name} · Blog`, description: data.category.description ?? undefined }
    : { title: 'Not found' };
}

export default async function BlogCategoryPage({
  params,
  searchParams,
}: PageProps<'/blog/category/[slug]'>) {
  if (!(await getSite()).features.blog) notFound();
  const data = await load((await params).slug);
  if (!data) notFound();
  const page = (await searchParams).page;
  const p = typeof page === 'string' && /^\d{1,4}$/.test(page) ? page : '1';
  const result = await cmsData<BlogPostList>(
    `/blog/posts?category=${data.category.slug}&page=${p}`,
  );
  return (
    <BlogList
      heading={data.category.name}
      intro={data.category.description}
      result={result}
      categories={data.categories}
      basePath={`/blog/category/${data.category.slug}`}
      active={data.category.slug}
    />
  );
}

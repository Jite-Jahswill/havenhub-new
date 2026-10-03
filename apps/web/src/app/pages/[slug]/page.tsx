import type { Metadata } from 'next';
import { permanentRedirect } from 'next/navigation';

import { CmsPage, pageMetadata } from '@/components/cms/cms-page';

const BUILT_IN = new Set(['about', 'contact', 'terms', 'privacy']);

export async function generateMetadata({ params }: PageProps<'/pages/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  return pageMetadata(slug, `/pages/${slug}`);
}

/** Custom pages created in the CMS. Built-in pages live at their own address. */
export default async function CustomPage({ params }: PageProps<'/pages/[slug]'>) {
  const { slug } = await params;
  if (BUILT_IN.has(slug)) permanentRedirect(`/${slug}`);
  return <CmsPage slug={slug} />;
}

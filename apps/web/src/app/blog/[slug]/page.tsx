import type { BlogPostDetail } from '@havenhub/shared';
import { Container } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { BlogCard } from '@/components/cms/blog-card';
import { JsonLd } from '@/components/cms/json-ld';
import { Markdown } from '@/components/cms/markdown';
import { Photo } from '@/components/properties/photo';
import { ShareButton } from '@/components/properties/share-button';
import { absoluteUrl, cmsData, getSite } from '@/lib/cms';
import { env } from '@/lib/env';
import { formatDate } from '@/lib/format';

const getPost = cache(async (slug: string) =>
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? cmsData<BlogPostDetail>(`/blog/posts/${slug}`) : null,
);

export async function generateMetadata({ params }: PageProps<'/blog/[slug]'>): Promise<Metadata> {
  const post = await getPost((await params).slug);
  if (!post) return { title: 'Article not found', robots: { index: false } };
  const title = post.seoTitle ?? post.title;
  const description = post.seoDescription ?? post.excerpt ?? undefined;
  const url = post.canonicalUrl ?? `${env.NEXT_PUBLIC_SITE_URL}/blog/${post.slug}`;
  return {
    title,
    description,
    ...(post.seoKeywords.length ? { keywords: post.seoKeywords } : {}),
    alternates: { canonical: url },
    ...(post.noIndex ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      title,
      description,
      url,
      type: 'article',
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt,
      ...(post.coverImage
        ? {
            images: [{ url: absoluteUrl(post.coverImage.url), alt: post.coverImage.altText ?? '' }],
          }
        : {}),
    },
    twitter: { card: post.coverImage ? 'summary_large_image' : 'summary', title, description },
  };
}

export default async function BlogPostPage({ params }: PageProps<'/blog/[slug]'>) {
  const [site, post] = await Promise.all([getSite(), getPost((await params).slug)]);
  if (!site.features.blog || !post) notFound();
  return (
    <Container className="py-8 lg:py-12">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: post.title,
          datePublished: post.publishedAt,
          dateModified: post.updatedAt,
          ...(post.authorName ? { author: { '@type': 'Person', name: post.authorName } } : {}),
          ...(post.coverImage ? { image: absoluteUrl(post.coverImage.url) } : {}),
          publisher: { '@type': 'Organization', name: site.siteName },
          mainEntityOfPage: `${env.NEXT_PUBLIC_SITE_URL}/blog/${post.slug}`,
        }}
      />
      <article className="mx-auto max-w-3xl">
        <nav aria-label="Breadcrumb" className="mb-4 text-sm text-text-secondary">
          <Link href="/blog" className="hover:text-text">
            Blog
          </Link>
          {post.category && (
            <>
              {' / '}
              <Link href={`/blog/category/${post.category.slug}`} className="hover:text-text">
                {post.category.name}
              </Link>
            </>
          )}
        </nav>
        <h1 className="text-3xl font-bold tracking-tight break-words text-text sm:text-4xl">
          {post.title}
        </h1>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-text-secondary">
          <p>
            {post.authorName ? `${post.authorName} · ` : ''}
            <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time> ·{' '}
            {post.readingMinutes} min read
          </p>
          <ShareButton title={post.title} />
        </div>
        {post.coverImage && (
          <div className="relative mt-8 aspect-[16/9] overflow-hidden rounded-card bg-surface-secondary">
            <Photo
              src={post.coverImage.url}
              alt={post.coverImage.altText ?? ''}
              sizes="(max-width: 768px) 100vw, 768px"
              priority
            />
          </div>
        )}
        {post.excerpt && <p className="mt-8 text-lg leading-relaxed text-text">{post.excerpt}</p>}
        <Markdown source={post.body} mediaBase={site.mediaBase} className="mt-8" />
        {post.tags.length > 0 && (
          <ul className="mt-10 flex flex-wrap gap-2" aria-label="Tags">
            {post.tags.map((t) => (
              <li key={t.slug}>
                <Link
                  href={`/blog/tag/${t.slug}`}
                  className="rounded-full border border-border px-3 py-1 text-sm text-text-secondary hover:bg-surface-secondary"
                >
                  #{t.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </article>
      {post.related.length > 0 && (
        <section aria-labelledby="related" className="mt-16">
          <h2 id="related" className="mb-6 text-xl font-bold tracking-tight text-text">
            Related articles
          </h2>
          <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {post.related.map((r) => (
              <BlogCard key={r.id} post={r} />
            ))}
          </div>
        </section>
      )}
    </Container>
  );
}

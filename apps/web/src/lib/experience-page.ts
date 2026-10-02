import 'server-only';

import { EXPERIENCE_KIND_LABELS, type ExperienceDetail } from '@havenhub/shared';
import type { Metadata } from 'next';
import { cache } from 'react';

import { serverApi } from './api/server';
import { env } from './env';
import { experiencePath } from './experiences';

const SLUG = /^[a-z0-9-]{3,160}$/;

/** One request per render, shared by metadata and the page. */
export const getExperience = cache(async (slug: string) => {
  if (!SLUG.test(slug)) return null;
  const res = await serverApi<ExperienceDetail>(`/experiences/${slug}`);
  return res.success ? res.data : null;
});

const absolute = (url: string) =>
  url.startsWith('http') ? url : `${env.NEXT_PUBLIC_SITE_URL}${url}`;

export function experienceMetadata(item: ExperienceDetail | null): Metadata {
  if (!item) return { title: 'Not found', robots: { index: false } };
  const place = [item.city, item.state].filter(Boolean).join(', ');
  const title = place ? `${item.title} · ${place}` : item.title;
  const description = `${EXPERIENCE_KIND_LABELS[item.kind].one}${place ? ` in ${place}` : ''}${
    item.description ? `: ${item.description.slice(0, 140)}` : ''
  }`;
  const url = `${env.NEXT_PUBLIC_SITE_URL}${experiencePath(item.kind, item.slug)}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: 'website',
      siteName: 'HavenHub',
      images: item.coverImage
        ? [{ url: absolute(item.coverImage.url), alt: item.title }]
        : undefined,
    },
    twitter: { card: item.coverImage ? 'summary_large_image' : 'summary', title, description },
  };
}

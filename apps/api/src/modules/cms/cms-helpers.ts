import { randomBytes } from 'node:crypto';

import { HttpStatus } from '@nestjs/common';
import {
  ErrorCode,
  isCmsImageSrc,
  markdownImageSources,
  type CmsImage,
  type ContentStatus,
} from '@havenhub/shared';

import { AppException } from '../../common/errors/app.exception';
import type { CmsMedia, Prisma } from '../../generated/prisma/client';
import type { StorageService } from '../../infrastructure/storage/storage.service';
import { amenitySlug } from '../properties/slug';

type Tx = Prisma.TransactionClient;

export const validationError = (path: string, message: string) =>
  new AppException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    ErrorCode.VALIDATION_ERROR,
    'Please check the highlighted fields.',
    { issues: [{ path, message }] },
  );

export const conflict = (message: string) =>
  new AppException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, message);

export const invalidTransition = (message: string) =>
  new AppException(HttpStatus.CONFLICT, ErrorCode.INVALID_STATUS_TRANSITION, message);

/** "/api/media" or the CDN origin — the prefix every public media URL starts with. */
export const mediaBase = (storage: Pick<StorageService, 'url'>) =>
  storage.url('cms').replace(/\/cms$/, '');

export function toCmsImage(media: CmsMedia, storage: Pick<StorageService, 'url'>): CmsImage {
  return {
    id: media.id,
    url: storage.url(media.storageKey),
    thumbnailUrl: storage.url(media.thumbnailKey),
    width: media.width,
    height: media.height,
    altText: media.altText,
  };
}

export const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

/**
 * A slug for new content. An explicit slug must be free (409 otherwise); a
 * derived one gets a short random suffix when the plain form is taken.
 */
export async function chooseSlug(
  explicit: string | undefined,
  title: string,
  max: number,
  taken: (slug: string) => Promise<boolean>,
): Promise<string> {
  if (explicit) {
    if (await taken(explicit)) throw conflict('That address (slug) is already used.');
    return explicit;
  }
  const base =
    amenitySlug(title)
      .slice(0, max - 7)
      .replace(/-+$/, '') || 'item';
  if (!(await taken(base))) return base;
  for (let i = 0; i < 5; i++) {
    const candidate = `${base}-${randomBytes(3).toString('hex')}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw conflict('Could not choose a unique address. Enter one yourself.');
}

/** A changed explicit slug must also be free (ignoring the record itself). */
export async function assertSlugFree(
  slug: string,
  taken: (slug: string) => Promise<boolean>,
): Promise<void> {
  if (await taken(slug)) throw conflict('That address (slug) is already used.');
}

/**
 * Every image a Markdown body asks for must be an uploaded CMS image — not
 * an arbitrary URL. (The renderer also refuses anything else; this gives the
 * author a clear error instead of a silently missing picture.)
 */
export async function assertMarkdownImages(
  tx: Tx,
  storage: Pick<StorageService, 'url'>,
  body: string | undefined,
  path: string,
): Promise<void> {
  if (!body) return;
  const sources = [...new Set(markdownImageSources(body))];
  if (!sources.length) return;
  const base = mediaBase(storage);
  const keys: string[] = [];
  for (const src of sources) {
    if (!isCmsImageSrc(src, base)) {
      throw validationError(path, 'Images must be chosen from the media library');
    }
    keys.push(src.slice(base.length + 1));
  }
  const found = await tx.cmsMedia.count({
    where: { OR: [{ storageKey: { in: keys } }, { thumbnailKey: { in: keys } }] },
  });
  if (found < keys.length) throw validationError(path, 'An image in the text no longer exists');
}

export async function assertMediaExists(
  tx: Tx,
  id: string | null | undefined,
  path: string,
): Promise<void> {
  if (!id) return;
  if (!(await tx.cmsMedia.count({ where: { id } }))) {
    throw validationError(path, 'Choose an image from the media library');
  }
}

/**
 * Lifecycle shared by pages and help articles:
 * draft ⇄ published, either → archived, archived → draft.
 */
export const CONTENT_TRANSITIONS: Record<ContentStatus, readonly ContentStatus[]> = {
  DRAFT: ['PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['DRAFT', 'ARCHIVED'],
  ARCHIVED: ['DRAFT'],
};

/** Approved rule: drafts may be deleted; published content must be archived first. */
export function assertDeletable(status: string): void {
  if (status === 'PUBLISHED') {
    throw invalidTransition('Archive published content before deleting it.');
  }
}

/** `isMediaReferenced`: the media is used somewhere, so deleting it would break content. */
export async function mediaUsage(tx: Tx, media: CmsMedia): Promise<string[]> {
  const like = (key: string) => ({ contains: key });
  const refs = await Promise.all([
    tx.page.count({ where: { OR: [{ ogImageId: media.id }, { body: like(media.storageKey) }] } }),
    tx.blogPost.count({
      where: { OR: [{ coverImageId: media.id }, { body: like(media.storageKey) }] },
    }),
    tx.helpArticle.count({ where: { body: like(media.storageKey) } }),
    tx.faq.count({ where: { answer: like(media.storageKey) } }),
    tx.testimonial.count({ where: { photoId: media.id } }),
    tx.seoRoute.count({ where: { ogImageId: media.id } }),
    tx.siteSettings.count({ where: { ogImageId: media.id } }),
    tx.jobPosting.count({
      where: {
        OR: [{ description: like(media.storageKey) }, { requirements: like(media.storageKey) }],
      },
    }),
    tx.emailCampaign.count({ where: { body: like(media.storageKey) } }),
    tx.homepageSection.count({
      where: { key: 'HERO', config: { path: ['imageId'], equals: media.id } },
    }),
    tx.popup.count({ where: { imageId: media.id } }),
    tx.badge.count({ where: { imageId: media.id } }),
  ]);
  const names = [
    'pages',
    'blog posts',
    'help articles',
    'FAQs',
    'testimonials',
    'SEO settings',
    'site settings',
    'job postings',
    'email campaigns',
    'the homepage hero',
    'pop-ups',
    'badges',
  ];
  return names.filter((_, i) => refs[i]! > 0);
}

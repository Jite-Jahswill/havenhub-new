import { z } from 'zod';

import {
  CMS_LIMITS,
  ContentStatus,
  EmploymentType,
  HomepageSectionKey,
  JobStatus,
  SEO_ROUTES,
  SITEMAP_SECTIONS,
  ApplicationStatus,
  SocialNetwork,
  SubscriberStatus,
  CampaignStatus,
} from '../enums/cms.js';
import { isSafeHref } from '../markdown/safe-url.js';
import { paginationQuerySchema } from './admin.js';
import { emailField } from './fields.js';

/**
 * CMS inputs (Phase 7). Plain-text fields are trimmed and stripped of
 * control/invisible characters; long-form fields are Markdown source whose
 * rendering is made safe by the Markdown module; every link must pass
 * `isSafeHref`.
 */

const CONTROL =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;
const clean = (v: string) => v.replace(/\r\n?/g, '\n').replace(CONTROL, '').trim();

/** Single-line text. */
export const plainText = (min: number, max: number) =>
  z
    .string()
    .transform((v) => clean(v).replace(/\s*\n\s*/g, ' '))
    .pipe(
      z
        .string()
        .min(min, min > 1 ? `Use at least ${min} characters` : 'Required')
        .max(max),
    );

/** Optional single-line text: blank becomes null. */
export const optionalText = (max: number) =>
  z
    .string()
    .transform((v) => clean(v).replace(/\s*\n\s*/g, ' ') || null)
    .pipe(z.string().max(max).nullable())
    .nullable()
    .optional();

/** Optional multi-line text (keeps line breaks). */
export const optionalMultiline = (max: number) =>
  z
    .string()
    .transform((v) => clean(v) || null)
    .pipe(z.string().max(max).nullable())
    .nullable()
    .optional();

/** Markdown source. */
export const markdownField = (max: number) =>
  z
    .string()
    .transform((v) => v.replace(/\r\n?/g, '\n').replace(CONTROL, ''))
    .pipe(z.string().max(max, `Keep this under ${max.toLocaleString('en')} characters`));

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const slugField = (max = 80) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .max(max)
    .regex(SLUG_PATTERN, 'Use lowercase letters, numbers and hyphens');

export const hrefField = z
  .string()
  .trim()
  .max(500)
  .refine(isSafeHref, 'Use a web address (https://…), a site path (/…), mailto: or tel:');

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^https:\/\//i.test(v) && isSafeHref(v), 'Use an https:// address');

const seoTitle = optionalText(70);
const seoDescription = optionalText(200);
const keywords = z
  .array(plainText(1, 50))
  .max(CMS_LIMITS.keywords)
  .transform((list) => [...new Set(list.map((k) => k.toLowerCase()))]);
const mediaId = z.uuid().nullable().optional();
const isoDateTime = z.iso.datetime({ offset: true });
const nonEmpty = <T extends object>(v: T) => Object.keys(v).length > 0;
const NOTHING = { message: 'Nothing to update' };

// ── Site settings & SEO ──

export const socialLinkSchema = z.object({ network: z.enum(SocialNetwork), url: httpsUrl });

export const updateSiteSettingsSchema = z
  .object({
    siteName: plainText(2, 60),
    tagline: optionalText(160),
    contactEmail: z
      .union([emailField, z.literal('').transform(() => null)])
      .nullable()
      .optional(),
    contactPhone: optionalText(40).refine((v) => !v || /^\+?[0-9 ()-]{5,40}$/.test(v), {
      message: 'Enter a valid phone number',
    }),
    contactAddress: optionalText(300),
    socialLinks: z.array(socialLinkSchema).max(CMS_LIMITS.socialLinks),
    footerText: optionalMultiline(500),
    blogEnabled: z.boolean(),
    careersEnabled: z.boolean(),
    helpCenterEnabled: z.boolean(),
    newsletterEnabled: z.boolean(),
    newsletterConsentText: optionalMultiline(1000),
    newsletterDoubleOptIn: z.boolean(),
    cvRetentionDays: z.number().int().min(1).max(3650).nullable(),
    newsletterRetentionDays: z.number().int().min(1).max(3650).nullable(),
  })
  .partial()
  .strict()
  .refine(nonEmpty, NOTHING);
export type UpdateSiteSettingsInput = z.input<typeof updateSiteSettingsSchema>;

export const updateSeoSettingsSchema = z
  .object({
    seoTitle,
    seoDescription,
    seoKeywords: keywords,
    ogImageId: mediaId,
    twitterHandle: z
      .string()
      .trim()
      .regex(/^@?[A-Za-z0-9_]{1,15}$/, 'Enter a handle like @havenhub')
      .transform((v) => (v.startsWith('@') ? v : `@${v}`))
      .or(z.literal('').transform(() => null))
      .nullable()
      .optional(),
    allowIndexing: z.boolean(),
    robotsDisallow: z
      .array(
        z
          .string()
          .trim()
          .regex(
            /^\/[A-Za-z0-9/_.*$-]*$/,
            'Paths start with / and use letters, numbers, / _ - . * $',
          ),
      )
      .max(CMS_LIMITS.robotsDisallow),
    sitemapSections: z.array(z.enum(SITEMAP_SECTIONS)).transform((v) => [...new Set(v)]),
  })
  .partial()
  .strict()
  .refine(nonEmpty, NOTHING);

export const upsertSeoRouteSchema = z
  .object({
    path: z.enum(SEO_ROUTES),
    title: seoTitle,
    description: seoDescription,
    ogImageId: mediaId,
    noIndex: z.boolean().optional(),
  })
  .strict();

// ── Homepage ──

export const linkSchema = z.object({ label: plainText(1, 40), href: hrefField });

/** How the hero image is used: behind the text, or beside it on wide screens. */
export const HERO_IMAGE_LAYOUTS = ['BACKGROUND', 'SIDE'] as const;
/** How much the background image is darkened so the text stays readable. */
export const HERO_OVERLAYS = ['LIGHT', 'MEDIUM', 'STRONG'] as const;

const heroConfig = z
  .object({
    eyebrow: optionalText(80),
    showSearch: z.boolean().default(true),
    searchPlaceholder: optionalText(80),
    links: z.array(linkSchema).max(CMS_LIMITS.heroLinks).default([]),
    /** From the media library; null = no image (text only). */
    imageId: z.uuid().nullable().default(null),
    imageLayout: z.enum(HERO_IMAGE_LAYOUTS).default('BACKGROUND'),
    overlay: z.enum(HERO_OVERLAYS).default('MEDIUM'),
  })
  .strict();
const exploreConfig = z
  .object({
    items: z
      .array(z.object({ title: plainText(1, 40), description: optionalText(160), href: hrefField }))
      .max(CMS_LIMITS.exploreItems)
      .default([]),
  })
  .strict();
const listingConfig = z
  .object({ limit: z.number().int().min(1).max(CMS_LIMITS.homepageItems).default(6) })
  .strict();
const ctaConfig = z.object({ button: linkSchema.nullable().default(null) }).strict();
/** Properties holding this badge (null = any badge), best rated first. */
const awardsConfig = z
  .object({
    limit: z.number().int().min(1).max(CMS_LIMITS.homepageItems).default(6),
    badgeId: z.uuid().nullable().default(null),
  })
  .strict();

/** The config shape each homepage section accepts. */
export function homepageConfigSchema(key: HomepageSectionKey) {
  switch (key) {
    case 'HERO':
      return heroConfig;
    case 'EXPLORE':
      return exploreConfig;
    case 'CTA':
      return ctaConfig;
    case 'AWARDS':
      return awardsConfig;
    default:
      return listingConfig;
  }
}

export const updateHomepageSectionSchema = z
  .object({
    enabled: z.boolean(),
    title: optionalText(120),
    subtitle: optionalText(300),
    /** Validated against `homepageConfigSchema(key)` by the API. */
    config: z.record(z.string(), z.unknown()),
  })
  .partial()
  .strict()
  .refine(nonEmpty, NOTHING);

export const reorderHomepageSchema = z.object({
  keys: z
    .array(z.enum(HomepageSectionKey))
    .refine((k) => new Set(k).size === k.length, { message: 'Each section once' })
    .refine((k) => k.length === Object.keys(HomepageSectionKey).length, {
      message: 'List every section',
    }),
});

// ── Testimonials & media ──

const testimonialFields = {
  quote: plainText(10, 600),
  authorName: plainText(2, 120),
  authorRole: optionalText(120),
  photoId: mediaId,
  published: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
};
export const createTestimonialSchema = z.object(testimonialFields).strict();
export const updateTestimonialSchema = z
  .object(testimonialFields)
  .partial()
  .strict()
  .refine(nonEmpty, NOTHING);

export const updateCmsMediaSchema = z.object({ altText: optionalText(200) }).strict();

// ── Content lifecycle ──

/** Status changes shared by pages and help articles. */
export const contentStatusActionSchema = z.object({
  status: z.enum(ContentStatus),
});

// ── Pages ──

const pageFields = {
  title: plainText(2, 160),
  slug: slugField(80).optional(),
  body: markdownField(CMS_LIMITS.pageBody).optional(),
  seoTitle,
  seoDescription,
  ogImageId: mediaId,
  noIndex: z.boolean().optional(),
};
export const createPageSchema = z.object(pageFields).strict();
export const updatePageSchema = z.object(pageFields).partial().strict().refine(nonEmpty, NOTHING);
export type CreatePageInput = z.input<typeof createPageSchema>;

export const adminContentListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(ContentStatus).optional(),
  search: z.string().trim().max(120).optional(),
});

// ── Blog ──

const categoryFields = {
  name: plainText(2, 80),
  slug: slugField(80).optional(),
  description: optionalText(300),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
};
export const createCategorySchema = z.object(categoryFields).strict();
export const updateCategorySchema = z
  .object(categoryFields)
  .partial()
  .strict()
  .refine(nonEmpty, NOTHING);

export const createTagSchema = z
  .object({ name: plainText(2, 60), slug: slugField(60).optional() })
  .strict();

const uniqueIds = (max: number) =>
  z
    .array(z.uuid())
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Duplicate entries' });

const postFields = {
  title: plainText(5, 160),
  slug: slugField(160).optional(),
  excerpt: optionalMultiline(400),
  body: markdownField(CMS_LIMITS.postBody).optional(),
  coverImageId: mediaId,
  categoryId: z.uuid().nullable().optional(),
  tagIds: uniqueIds(CMS_LIMITS.tagsPerPost).optional(),
  relatedIds: uniqueIds(CMS_LIMITS.relatedPerPost).optional(),
  authorName: optionalText(120),
  seoTitle,
  seoDescription,
  seoKeywords: keywords.optional(),
  canonicalUrl: httpsUrl
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  noIndex: z.boolean().optional(),
};
export const createPostSchema = z.object(postFields).strict();
export const updatePostSchema = z.object(postFields).partial().strict().refine(nonEmpty, NOTHING);
export type CreatePostInput = z.input<typeof createPostSchema>;

/** Publish now, or schedule for later (a future `publishAt`). */
export const publishPostSchema = z.object({ publishAt: isoDateTime.optional() }).strict();

export const adminPostListQuerySchema = adminContentListQuerySchema.extend({
  categoryId: z.uuid().optional(),
});

export const publicPostListQuerySchema = paginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(30).default(12),
  q: z.string().trim().max(100).optional(),
  category: slugField(80).optional(),
  tag: slugField(60).optional(),
});

// ── Help centre ──

export const createHelpCategorySchema = createCategorySchema;
export const updateHelpCategorySchema = updateCategorySchema;

const articleFields = {
  title: plainText(5, 160),
  slug: slugField(160).optional(),
  summary: optionalText(300),
  body: markdownField(CMS_LIMITS.helpBody).optional(),
  categoryId: z.uuid(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  seoTitle,
  seoDescription,
};
export const createHelpArticleSchema = z.object(articleFields).strict();
export const updateHelpArticleSchema = z
  .object(articleFields)
  .partial()
  .strict()
  .refine(nonEmpty, NOTHING);

const faqFields = {
  question: plainText(5, 300),
  answer: markdownField(CMS_LIMITS.faqAnswer).pipe(z.string().min(1, 'Required')),
  categoryId: z.uuid().nullable().optional(),
  published: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
};
export const createFaqSchema = z.object(faqFields).strict();
export const updateFaqSchema = z.object(faqFields).partial().strict().refine(nonEmpty, NOTHING);

export const helpSearchQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: slugField(80).optional(),
});

// ── Careers ──

const jobFields = {
  title: plainText(3, 160),
  slug: slugField(160).optional(),
  department: optionalText(80),
  location: plainText(2, 160),
  employmentType: z.enum(EmploymentType),
  description: markdownField(CMS_LIMITS.pageBody).optional(),
  requirements: markdownField(CMS_LIMITS.pageBody).optional(),
  closesAt: isoDateTime.nullable().optional(),
  seoTitle,
  seoDescription,
};
export const createJobSchema = z.object(jobFields).strict();
export const updateJobSchema = z.object(jobFields).partial().strict().refine(nonEmpty, NOTHING);

export const jobStatusActionSchema = z.object({ status: z.enum(JobStatus) });

export const adminJobListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(JobStatus).optional(),
  search: z.string().trim().max(120).optional(),
});

/** Public application form (multipart fields; the CV is the `cv` file). */
export const jobApplicationSchema = z.object({
  fullName: plainText(2, 120),
  email: emailField,
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number')
    .transform((v) => v.replace(/[\s()-]/g, '')),
  coverNote: optionalMultiline(CMS_LIMITS.coverNote),
});
export type JobApplicationInput = z.input<typeof jobApplicationSchema>;

export const adminApplicationListQuerySchema = paginationQuerySchema.extend({
  jobId: z.uuid().optional(),
  status: z.enum(ApplicationStatus).optional(),
});

export const updateApplicationStatusSchema = z.object({ status: z.enum(ApplicationStatus) });

// ── Newsletter ──

export const newsletterSubscribeSchema = z.object({
  email: emailField,
  /** The signup must tick the consent box; the consent text shown is recorded. */
  consent: z.literal(true, { message: 'Tick the box to agree' }),
  source: z.enum(['footer', 'blog', 'page']).default('footer'),
});
export type NewsletterSubscribeInput = z.input<typeof newsletterSubscribeSchema>;

export const newsletterTokenSchema = z.object({ token: z.string().trim().min(20).max(200) });

export const adminSubscriberListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(SubscriberStatus).optional(),
  search: z.string().trim().max(120).optional(),
});

const campaignFields = {
  name: plainText(2, 120),
  subject: plainText(2, 160),
  body: markdownField(CMS_LIMITS.campaignBody).pipe(z.string().min(1, 'Write the email')),
};
export const createCampaignSchema = z.object(campaignFields).strict();
export const updateCampaignSchema = z
  .object(campaignFields)
  .partial()
  .strict()
  .refine(nonEmpty, NOTHING);

/** Send as soon as possible, or at `scheduledAt`. */
export const scheduleCampaignSchema = z.object({ scheduledAt: isoDateTime.optional() }).strict();

export const adminCampaignListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(CampaignStatus).optional(),
});

// ── Support (Phase 5 chat) ──

export const adminSupportListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['OPEN', 'CLOSED']).optional(),
  scope: z.enum(['all', 'mine', 'unassigned']).default('all'),
  search: z.string().trim().max(120).optional(),
});

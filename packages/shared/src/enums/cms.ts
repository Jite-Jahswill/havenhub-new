/**
 * CMS (Phase 7): site content, homepage builder, pages, blog, help centre,
 * careers, SEO and newsletter.
 */
export const ContentStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type ContentStatus = (typeof ContentStatus)[keyof typeof ContentStatus];

export const HomepageSectionKey = {
  HERO: 'HERO',
  EXPLORE: 'EXPLORE',
  FEATURED_PROPERTIES: 'FEATURED_PROPERTIES',
  POPULAR_LOCATIONS: 'POPULAR_LOCATIONS',
  RENT_PROPERTIES: 'RENT_PROPERTIES',
  SALE_PROPERTIES: 'SALE_PROPERTIES',
  VACATION_ZONES: 'VACATION_ZONES',
  HOTELS: 'HOTELS',
  EVENTS: 'EVENTS',
  TOURS: 'TOURS',
  CLEANING: 'CLEANING',
  SPECIAL_OFFERS: 'SPECIAL_OFFERS',
  AWARDS: 'AWARDS',
  BLOG: 'BLOG',
  TESTIMONIALS: 'TESTIMONIALS',
  CTA: 'CTA',
} as const;
export type HomepageSectionKey = (typeof HomepageSectionKey)[keyof typeof HomepageSectionKey];

export interface HomepageSectionDefinition {
  key: HomepageSectionKey;
  label: string;
  /**
   * False when the feature the section shows does not exist yet (discounts,
   * awards). Such sections can never be enabled or rendered.
   */
  available: boolean;
  /** Sections that list records take an item limit. */
  listing: boolean;
  unavailableReason?: string;
}

/** Display metadata for every section (§37, §55). */
export const HOMEPAGE_SECTIONS: readonly HomepageSectionDefinition[] = [
  { key: 'HERO', label: 'Hero', available: true, listing: false },
  { key: 'EXPLORE', label: 'Explore categories', available: true, listing: false },
  { key: 'FEATURED_PROPERTIES', label: 'Featured properties', available: true, listing: true },
  { key: 'POPULAR_LOCATIONS', label: 'Popular locations', available: true, listing: true },
  { key: 'RENT_PROPERTIES', label: 'Properties for rent', available: true, listing: true },
  { key: 'SALE_PROPERTIES', label: 'Properties for sale', available: true, listing: true },
  { key: 'VACATION_ZONES', label: 'Vacation zones', available: true, listing: true },
  { key: 'HOTELS', label: 'Hotels & stays', available: true, listing: true },
  { key: 'EVENTS', label: 'Events', available: true, listing: true },
  { key: 'TOURS', label: 'Tours & experiences', available: true, listing: true },
  { key: 'CLEANING', label: 'Cleaning services', available: true, listing: true },
  { key: 'SPECIAL_OFFERS', label: 'Special offers', available: true, listing: true },
  { key: 'AWARDS', label: 'Award-winning properties', available: true, listing: true },
  { key: 'BLOG', label: 'Blog', available: true, listing: true },
  { key: 'TESTIMONIALS', label: 'Testimonials', available: true, listing: true },
  { key: 'CTA', label: 'Call to action', available: true, listing: false },
];

export const homepageSectionDefinition = (key: HomepageSectionKey) =>
  HOMEPAGE_SECTIONS.find((s) => s.key === key)!;

export const JobStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  CLOSED: 'CLOSED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export const EmploymentType = {
  FULL_TIME: 'FULL_TIME',
  PART_TIME: 'PART_TIME',
  CONTRACT: 'CONTRACT',
  INTERNSHIP: 'INTERNSHIP',
  TEMPORARY: 'TEMPORARY',
} as const;
export type EmploymentType = (typeof EmploymentType)[keyof typeof EmploymentType];

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACT: 'Contract',
  INTERNSHIP: 'Internship',
  TEMPORARY: 'Temporary',
};

export const ApplicationStatus = {
  NEW: 'NEW',
  REVIEWED: 'REVIEWED',
  SHORTLISTED: 'SHORTLISTED',
  REJECTED: 'REJECTED',
  HIRED: 'HIRED',
} as const;
export type ApplicationStatus = (typeof ApplicationStatus)[keyof typeof ApplicationStatus];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  NEW: 'New',
  REVIEWED: 'Reviewed',
  SHORTLISTED: 'Shortlisted',
  REJECTED: 'Rejected',
  HIRED: 'Hired',
};

/**
 * New → Reviewed → Shortlisted → Hired, with Rejected possible once an
 * application has been reviewed. Rejected and Hired are final.
 */
export const APPLICATION_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  NEW: ['REVIEWED'],
  REVIEWED: ['SHORTLISTED', 'REJECTED'],
  SHORTLISTED: ['HIRED', 'REJECTED'],
  REJECTED: [],
  HIRED: [],
};

export const SubscriberStatus = {
  PENDING: 'PENDING',
  SUBSCRIBED: 'SUBSCRIBED',
  UNSUBSCRIBED: 'UNSUBSCRIBED',
} as const;
export type SubscriberStatus = (typeof SubscriberStatus)[keyof typeof SubscriberStatus];

export const CampaignStatus = {
  DRAFT: 'DRAFT',
  SCHEDULED: 'SCHEDULED',
  SENDING: 'SENDING',
  SENT: 'SENT',
  CANCELLED: 'CANCELLED',
} as const;
export type CampaignStatus = (typeof CampaignStatus)[keyof typeof CampaignStatus];

export const SocialNetwork = {
  FACEBOOK: 'FACEBOOK',
  INSTAGRAM: 'INSTAGRAM',
  X: 'X',
  LINKEDIN: 'LINKEDIN',
  YOUTUBE: 'YOUTUBE',
  TIKTOK: 'TIKTOK',
  WHATSAPP: 'WHATSAPP',
} as const;
export type SocialNetwork = (typeof SocialNetwork)[keyof typeof SocialNetwork];

export const SOCIAL_NETWORK_LABELS: Record<SocialNetwork, string> = {
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
  X: 'X (Twitter)',
  LINKEDIN: 'LinkedIn',
  YOUTUBE: 'YouTube',
  TIKTOK: 'TikTok',
  WHATSAPP: 'WhatsApp',
};

/** Fixed public routes whose metadata admins can override. */
export const SEO_ROUTES = [
  '/',
  '/properties',
  '/experiences',
  '/events',
  '/tours',
  '/hotels',
  '/cleaning',
  '/destinations',
  '/blog',
  '/help',
  '/careers',
] as const;
export type SeoRoutePath = (typeof SEO_ROUTES)[number];

/** Groups of public URLs that can be listed in sitemap.xml. */
export const SITEMAP_SECTIONS = [
  'properties',
  'events',
  'tours',
  'hotels',
  'cleaning',
  'destinations',
  'blog',
  'help',
  'careers',
  'pages',
] as const;
export type SitemapSection = (typeof SITEMAP_SECTIONS)[number];

/** Built-in pages: they exist from the start (as drafts) and keep their slug. */
export const SYSTEM_PAGES = ['about', 'contact', 'terms', 'privacy'] as const;
export type SystemPageSlug = (typeof SYSTEM_PAGES)[number];

/**
 * Technical bounds (not business rules): they keep documents, requests and
 * pages to a sane size.
 */
export const CMS_LIMITS = {
  pageBody: 100_000,
  postBody: 100_000,
  helpBody: 50_000,
  faqAnswer: 5_000,
  campaignBody: 50_000,
  /** Approved: CVs are PDF or DOCX, at most 5 MB. */
  cvBytes: 5 * 1024 * 1024,
  coverNote: 4_000,
  tagsPerPost: 20,
  relatedPerPost: 6,
  socialLinks: 10,
  exploreItems: 12,
  heroLinks: 6,
  homepageItems: 12,
  keywords: 20,
  robotsDisallow: 50,
} as const;

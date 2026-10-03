import type {
  ApplicationStatus,
  CampaignStatus,
  ContentStatus,
  EmploymentType,
  HomepageSectionKey,
  JobStatus,
  SeoRoutePath,
  SitemapSection,
  SocialNetwork,
  SubscriberStatus,
  SystemPageSlug,
} from '../enums/cms.js';
import type { ExperienceCard, VacationZoneCard } from './experience.js';
import type { PropertyCard } from './property.js';

/** CMS API shapes (Phase 7). Long-form fields are Markdown source. */

export interface CmsImage {
  id: string;
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  altText: string | null;
}

export interface SocialLink {
  network: SocialNetwork;
  url: string;
}

/** Everything the public layout needs (header, footer, defaults). */
export interface PublicSiteView {
  siteName: string;
  tagline: string | null;
  logo: { url: string; width: number; height: number } | null;
  faviconUrl: string | null;
  contact: { email: string | null; phone: string | null; address: string | null };
  socialLinks: SocialLink[];
  footerText: string | null;
  features: { blog: boolean; careers: boolean; helpCenter: boolean; newsletter: boolean };
  newsletter: { consentText: string | null } | null;
  /** Built-in pages that are published, for footer links. */
  pages: { slug: SystemPageSlug; title: string }[];
  seo: {
    title: string | null;
    description: string | null;
    keywords: string[];
    ogImageUrl: string | null;
    twitterHandle: string | null;
    allowIndexing: boolean;
  };
  /** Public media base, for validating CMS images in Markdown. */
  mediaBase: string;
}

export interface AdminSiteSettingsView {
  siteName: string;
  tagline: string | null;
  logo: { url: string; width: number; height: number } | null;
  faviconUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactAddress: string | null;
  socialLinks: SocialLink[];
  footerText: string | null;
  blogEnabled: boolean;
  careersEnabled: boolean;
  helpCenterEnabled: boolean;
  newsletterEnabled: boolean;
  newsletterConsentText: string | null;
  newsletterDoubleOptIn: boolean;
  cvRetentionDays: number | null;
  newsletterRetentionDays: number | null;
  updatedAt: string;
}

export interface AdminSeoSettingsView {
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeywords: string[];
  ogImage: CmsImage | null;
  twitterHandle: string | null;
  allowIndexing: boolean;
  robotsDisallow: string[];
  sitemapSections: SitemapSection[];
  routes: SeoRouteView[];
}

export interface SeoRouteView {
  path: SeoRoutePath;
  title: string | null;
  description: string | null;
  ogImage: CmsImage | null;
  noIndex: boolean;
}

export interface HomepageLink {
  label: string;
  href: string;
}

export interface AdminHomepageSection {
  key: HomepageSectionKey;
  label: string;
  available: boolean;
  unavailableReason: string | null;
  enabled: boolean;
  sortOrder: number;
  title: string | null;
  subtitle: string | null;
  config: Record<string, unknown>;
}

export type HomepageSectionView =
  | {
      key: 'HERO';
      title: string | null;
      subtitle: string | null;
      eyebrow: string | null;
      showSearch: boolean;
      searchPlaceholder: string | null;
      links: HomepageLink[];
    }
  | {
      key: 'EXPLORE';
      title: string | null;
      subtitle: string | null;
      items: { title: string; description: string | null; href: string }[];
    }
  | {
      key: 'FEATURED_PROPERTIES' | 'RENT_PROPERTIES' | 'SALE_PROPERTIES';
      title: string | null;
      subtitle: string | null;
      properties: PropertyCard[];
    }
  | {
      key: 'POPULAR_LOCATIONS';
      title: string | null;
      subtitle: string | null;
      locations: { city: string; state: string; count: number }[];
    }
  | {
      key: 'VACATION_ZONES';
      title: string | null;
      subtitle: string | null;
      zones: VacationZoneCard[];
    }
  | {
      key: 'HOTELS' | 'EVENTS' | 'TOURS' | 'CLEANING';
      title: string | null;
      subtitle: string | null;
      experiences: ExperienceCard[];
    }
  | { key: 'BLOG'; title: string | null; subtitle: string | null; posts: BlogPostCard[] }
  | {
      key: 'TESTIMONIALS';
      title: string | null;
      subtitle: string | null;
      testimonials: TestimonialView[];
    }
  | {
      key: 'CTA';
      title: string | null;
      subtitle: string | null;
      button: HomepageLink | null;
    };

export interface TestimonialView {
  id: string;
  quote: string;
  authorName: string;
  authorRole: string | null;
  photo: CmsImage | null;
}

export interface AdminTestimonialView extends TestimonialView {
  published: boolean;
  sortOrder: number;
  updatedAt: string;
}

export interface CmsMediaView extends CmsImage {
  bytes: number;
  createdAt: string;
  uploadedBy: string | null;
}

// ── Pages ──

export interface PublicPageView {
  slug: string;
  title: string;
  body: string;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImage: CmsImage | null;
  noIndex: boolean;
  publishedAt: string;
  updatedAt: string;
}

export interface AdminPageListItem {
  id: string;
  slug: string;
  title: string;
  status: ContentStatus;
  system: boolean;
  publishedAt: string | null;
  updatedAt: string;
}

export interface AdminPageView extends AdminPageListItem {
  body: string;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImage: CmsImage | null;
  noIndex: boolean;
  createdAt: string;
}

// ── Blog ──

export interface BlogCategoryView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  postCount: number;
}

export interface BlogTagView {
  id: string;
  slug: string;
  name: string;
  postCount: number;
}

export interface BlogPostCard {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImage: CmsImage | null;
  category: { slug: string; name: string } | null;
  authorName: string | null;
  readingMinutes: number;
  publishedAt: string;
}

export interface BlogPostDetail extends BlogPostCard {
  body: string;
  tags: { slug: string; name: string }[];
  related: BlogPostCard[];
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeywords: string[];
  canonicalUrl: string | null;
  noIndex: boolean;
  updatedAt: string;
}

export interface BlogPostList {
  items: BlogPostCard[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Derived for the admin: PUBLISHED with a future publishAt is "scheduled". */
export type PostDisplayStatus = ContentStatus | 'SCHEDULED';

export interface AdminPostListItem {
  id: string;
  slug: string;
  title: string;
  status: ContentStatus;
  displayStatus: PostDisplayStatus;
  publishAt: string | null;
  category: { id: string; name: string } | null;
  authorName: string | null;
  updatedAt: string;
}

export interface AdminPostView extends AdminPostListItem {
  excerpt: string | null;
  body: string;
  coverImage: CmsImage | null;
  tags: { id: string; slug: string; name: string }[];
  related: { id: string; title: string; slug: string }[];
  readingMinutes: number;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeywords: string[];
  canonicalUrl: string | null;
  noIndex: boolean;
  createdAt: string;
}

// ── Help centre ──

export interface HelpCategoryView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  articleCount: number;
}

export interface HelpArticleCard {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  category: { slug: string; name: string };
}

export interface HelpArticleDetail extends HelpArticleCard {
  body: string;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: string;
}

export interface FaqView {
  id: string;
  question: string;
  answer: string;
  category: { slug: string; name: string } | null;
}

export interface AdminHelpArticleView {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  body: string;
  status: ContentStatus;
  categoryId: string;
  categoryName: string;
  sortOrder: number;
  seoTitle: string | null;
  seoDescription: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

export interface AdminFaqView extends FaqView {
  categoryId: string | null;
  published: boolean;
  sortOrder: number;
  updatedAt: string;
}

// ── Careers ──

export interface JobCard {
  id: string;
  slug: string;
  title: string;
  department: string | null;
  location: string;
  employmentType: EmploymentType;
  publishedAt: string;
  closesAt: string | null;
}

export interface JobDetail extends JobCard {
  description: string;
  requirements: string;
  /** False once closed or past its closing date. */
  acceptingApplications: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
}

export interface AdminJobView {
  id: string;
  slug: string;
  title: string;
  department: string | null;
  location: string;
  employmentType: EmploymentType;
  description: string;
  requirements: string;
  status: JobStatus;
  publishedAt: string | null;
  closesAt: string | null;
  closedAt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  applicationCount: number;
  updatedAt: string;
}

export interface AdminApplicationListItem {
  id: string;
  job: { id: string; title: string };
  fullName: string;
  email: string;
  status: ApplicationStatus;
  hasCv: boolean;
  createdAt: string;
}

export interface AdminApplicationView extends AdminApplicationListItem {
  phone: string;
  coverNote: string | null;
  cv: { fileName: string; contentType: string; bytes: number } | null;
  cvDeletedAt: string | null;
  nextStatuses: ApplicationStatus[];
  reviewedBy: string | null;
  statusChangedAt: string | null;
}

// ── Newsletter ──

export interface AdminSubscriberView {
  id: string;
  email: string;
  status: SubscriberStatus;
  consentSource: string | null;
  consentAt: string | null;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
  createdAt: string;
}

export interface AdminSubscriberDetail extends AdminSubscriberView {
  consentText: string | null;
  history: { type: string; source: string | null; consentText: string | null; at: string }[];
}

export interface CampaignStats {
  total: number;
  pending: number;
  sent: number;
  failed: number;
  skipped: number;
}

export interface AdminCampaignView {
  id: string;
  name: string;
  subject: string;
  body: string;
  status: CampaignStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  stats: CampaignStats;
  /** Subscribers who would receive it if sent now. */
  eligibleRecipients: number;
  updatedAt: string;
}

// ── SEO / sitemap ──

export interface SitemapEntry {
  path: string;
  lastModified: string | null;
}

export interface PublicSeoView {
  routes: Partial<
    Record<
      SeoRoutePath,
      {
        title: string | null;
        description: string | null;
        ogImageUrl: string | null;
        noIndex: boolean;
      }
    >
  >;
  robots: { allowIndexing: boolean; disallow: string[] };
}

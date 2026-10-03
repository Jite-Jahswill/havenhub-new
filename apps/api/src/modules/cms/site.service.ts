import { Injectable } from '@nestjs/common';
import {
  SEO_ROUTES,
  SITEMAP_SECTIONS,
  SYSTEM_PAGES,
  type AdminSeoSettingsView,
  type AdminSiteSettingsView,
  type PublicSeoView,
  type PublicSiteView,
  type SeoRoutePath,
  type SitemapEntry,
  type SitemapSection,
  type SocialLink,
  type SystemPageSlug,
  type updateSeoSettingsSchema,
  type updateSiteSettingsSchema,
  type upsertSeoRouteSchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import type { RequestMeta } from '../../common/http/request-meta';
import type { Prisma, SiteSettings } from '../../generated/prisma/client';
import { ImageProcessor } from '../../infrastructure/media/image-processor.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { PUBLIC_EXPERIENCE_WHERE } from '../experiences/experience.selects';
import { PUBLIC_PROPERTY_WHERE } from '../properties/property.selects';
import { CmsCacheService } from './cms-cache.service';
import { assertMediaExists, iso, mediaBase, toCmsImage } from './cms-helpers';

type Db = Prisma.TransactionClient | PrismaService;
type Out<T extends z.ZodType> = z.output<T>;

/** Private and transactional areas are never indexed, whatever the settings say. */
export const ALWAYS_DISALLOWED = [
  '/admin',
  '/agent',
  '/account',
  '/api',
  '/internal',
  '/login',
  '/register',
  '/newsletter',
  '/payments',
];

const SITEMAP_LIMIT = 45_000;

/** Site settings, logo/favicon, SEO defaults, route overrides and sitemap data. */
@Injectable()
export class SiteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly images: ImageProcessor,
    private readonly audit: AuditService,
    private readonly cache: CmsCacheService,
  ) {}

  /** The settings row (created with defaults if the seed has not run). */
  async row(db: Db = this.prisma): Promise<SiteSettings> {
    const existing = await db.siteSettings.findUnique({ where: { id: 1 } });
    if (existing) return existing;
    return db.siteSettings.upsert({
      where: { id: 1 },
      create: { id: 1, sitemapSections: [...SITEMAP_SECTIONS] },
      update: {},
    });
  }

  publicSite(): Promise<PublicSiteView> {
    return this.cache.get('site', 300, async () => {
      const s = await this.row();
      const [pages, ogImage] = await Promise.all([
        this.prisma.page.findMany({
          where: { system: true, status: 'PUBLISHED', slug: { in: [...SYSTEM_PAGES] } },
          select: { slug: true, title: true },
        }),
        s.ogImageId ? this.prisma.cmsMedia.findUnique({ where: { id: s.ogImageId } }) : null,
      ]);
      const order = (slug: string) => SYSTEM_PAGES.indexOf(slug as SystemPageSlug);
      return {
        siteName: s.siteName,
        tagline: s.tagline,
        logo:
          s.logoKey && s.logoWidth && s.logoHeight
            ? { url: this.storage.url(s.logoKey), width: s.logoWidth, height: s.logoHeight }
            : null,
        faviconUrl: this.storage.url(s.faviconKey),
        contact: { email: s.contactEmail, phone: s.contactPhone, address: s.contactAddress },
        socialLinks: s.socialLinks as unknown as SocialLink[],
        footerText: s.footerText,
        features: {
          blog: s.blogEnabled,
          careers: s.careersEnabled,
          helpCenter: s.helpCenterEnabled,
          newsletter: s.newsletterEnabled,
        },
        newsletter: s.newsletterEnabled ? { consentText: s.newsletterConsentText } : null,
        pages: pages
          .sort((a, b) => order(a.slug) - order(b.slug))
          .map((p) => ({ slug: p.slug as SystemPageSlug, title: p.title })),
        seo: {
          title: s.seoTitle,
          description: s.seoDescription,
          keywords: s.seoKeywords,
          ogImageUrl: ogImage ? this.storage.url(ogImage.storageKey) : null,
          twitterHandle: s.twitterHandle,
          allowIndexing: s.allowIndexing,
        },
        mediaBase: mediaBase(this.storage),
      };
    });
  }

  async adminSettings(): Promise<AdminSiteSettingsView> {
    const s = await this.row();
    return {
      siteName: s.siteName,
      tagline: s.tagline,
      logo:
        s.logoKey && s.logoWidth && s.logoHeight
          ? { url: this.storage.url(s.logoKey), width: s.logoWidth, height: s.logoHeight }
          : null,
      faviconUrl: this.storage.url(s.faviconKey),
      contactEmail: s.contactEmail,
      contactPhone: s.contactPhone,
      contactAddress: s.contactAddress,
      socialLinks: s.socialLinks as unknown as SocialLink[],
      footerText: s.footerText,
      blogEnabled: s.blogEnabled,
      careersEnabled: s.careersEnabled,
      helpCenterEnabled: s.helpCenterEnabled,
      newsletterEnabled: s.newsletterEnabled,
      newsletterConsentText: s.newsletterConsentText,
      newsletterDoubleOptIn: s.newsletterDoubleOptIn,
      cvRetentionDays: s.cvRetentionDays,
      newsletterRetentionDays: s.newsletterRetentionDays,
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  async updateSettings(
    actorId: string,
    input: Out<typeof updateSiteSettingsSchema>,
    meta: RequestMeta,
  ): Promise<AdminSiteSettingsView> {
    await this.prisma.$transaction(async (tx) => {
      const before = await this.row(tx);
      await tx.siteSettings.update({
        where: { id: 1 },
        data: {
          ...input,
          socialLinks: input.socialLinks,
          updatedById: actorId,
        },
      });
      await this.audit.record(
        {
          actorId,
          action: 'cms.site_settings.updated',
          resourceType: 'site_settings',
          resourceId: '1',
          before: pick(before, Object.keys(input)),
          after: input,
          meta,
        },
        tx,
      );
    });
    await this.cache.invalidate();
    return this.adminSettings();
  }

  /** Logo (WebP, transparency kept) or favicon (64 px PNG). */
  async setBrandImage(
    actorId: string,
    kind: 'logo' | 'favicon',
    file: Buffer,
    meta: RequestMeta,
  ): Promise<AdminSiteSettingsView> {
    const image = kind === 'logo' ? await this.images.logo(file) : await this.images.favicon(file);
    const key = this.storage.newKey('cms/site', kind, kind === 'logo' ? 'webp' : 'png');
    await this.storage.put(key, image.buffer, kind === 'logo' ? 'image/webp' : 'image/png');
    let previous: string | null = null;
    try {
      await this.prisma.$transaction(async (tx) => {
        const before = await this.row(tx);
        previous = kind === 'logo' ? before.logoKey : before.faviconKey;
        await tx.siteSettings.update({
          where: { id: 1 },
          data:
            kind === 'logo'
              ? {
                  logoKey: key,
                  logoWidth: image.width,
                  logoHeight: image.height,
                  updatedById: actorId,
                }
              : { faviconKey: key, updatedById: actorId },
        });
        await this.audit.record(
          {
            actorId,
            action: `cms.site_settings.${kind}_set`,
            resourceType: 'site_settings',
            resourceId: '1',
            meta,
          },
          tx,
        );
      });
    } catch (error) {
      await this.storage.deleteQuietly(key);
      throw error;
    }
    if (previous) await this.storage.deleteQuietly(previous);
    await this.cache.invalidate();
    return this.adminSettings();
  }

  async removeBrandImage(
    actorId: string,
    kind: 'logo' | 'favicon',
    meta: RequestMeta,
  ): Promise<AdminSiteSettingsView> {
    const previous = await this.prisma.$transaction(async (tx) => {
      const before = await this.row(tx);
      await tx.siteSettings.update({
        where: { id: 1 },
        data:
          kind === 'logo'
            ? { logoKey: null, logoWidth: null, logoHeight: null, updatedById: actorId }
            : { faviconKey: null, updatedById: actorId },
      });
      await this.audit.record(
        {
          actorId,
          action: `cms.site_settings.${kind}_removed`,
          resourceType: 'site_settings',
          resourceId: '1',
          meta,
        },
        tx,
      );
      return kind === 'logo' ? before.logoKey : before.faviconKey;
    });
    if (previous) await this.storage.deleteQuietly(previous);
    await this.cache.invalidate();
    return this.adminSettings();
  }

  // ── SEO ──

  async adminSeo(): Promise<AdminSeoSettingsView> {
    const s = await this.row();
    const [og, routes] = await Promise.all([
      s.ogImageId ? this.prisma.cmsMedia.findUnique({ where: { id: s.ogImageId } }) : null,
      this.prisma.seoRoute.findMany({ include: { ogImage: true } }),
    ]);
    const byPath = new Map(routes.map((r) => [r.path, r]));
    return {
      seoTitle: s.seoTitle,
      seoDescription: s.seoDescription,
      seoKeywords: s.seoKeywords,
      ogImage: og ? toCmsImage(og, this.storage) : null,
      twitterHandle: s.twitterHandle,
      allowIndexing: s.allowIndexing,
      robotsDisallow: s.robotsDisallow,
      sitemapSections: s.sitemapSections.filter((x): x is SitemapSection =>
        (SITEMAP_SECTIONS as readonly string[]).includes(x),
      ),
      routes: SEO_ROUTES.map((path) => {
        const r = byPath.get(path);
        return {
          path,
          title: r?.title ?? null,
          description: r?.description ?? null,
          ogImage: r?.ogImage ? toCmsImage(r.ogImage, this.storage) : null,
          noIndex: r?.noIndex ?? false,
        };
      }),
    };
  }

  async updateSeo(
    actorId: string,
    input: Out<typeof updateSeoSettingsSchema>,
    meta: RequestMeta,
  ): Promise<AdminSeoSettingsView> {
    await this.prisma.$transaction(async (tx) => {
      await this.row(tx);
      await assertMediaExists(tx, input.ogImageId, 'ogImageId');
      await tx.siteSettings.update({ where: { id: 1 }, data: { ...input, updatedById: actorId } });
      await this.audit.record(
        {
          actorId,
          action: 'cms.seo.updated',
          resourceType: 'site_settings',
          resourceId: '1',
          after: input,
          meta,
        },
        tx,
      );
    });
    await this.cache.invalidate();
    return this.adminSeo();
  }

  async upsertRoute(
    actorId: string,
    input: Out<typeof upsertSeoRouteSchema>,
    meta: RequestMeta,
  ): Promise<AdminSeoSettingsView> {
    await this.prisma.$transaction(async (tx) => {
      await assertMediaExists(tx, input.ogImageId, 'ogImageId');
      const data = {
        title: input.title ?? null,
        description: input.description ?? null,
        ogImageId: input.ogImageId ?? null,
        noIndex: input.noIndex ?? false,
      };
      await tx.seoRoute.upsert({
        where: { path: input.path },
        create: { path: input.path, ...data },
        update: data,
      });
      await this.audit.record(
        {
          actorId,
          action: 'cms.seo.route_updated',
          resourceType: 'seo_route',
          resourceId: input.path,
          after: data,
          meta,
        },
        tx,
      );
    });
    await this.cache.invalidate();
    return this.adminSeo();
  }

  publicSeo(): Promise<PublicSeoView> {
    return this.cache.get('seo', 300, async () => {
      const [s, routes] = await Promise.all([
        this.row(),
        this.prisma.seoRoute.findMany({ include: { ogImage: true } }),
      ]);
      return {
        routes: Object.fromEntries(
          routes.map((r) => [
            r.path as SeoRoutePath,
            {
              title: r.title,
              description: r.description,
              ogImageUrl: r.ogImage ? this.storage.url(r.ogImage.storageKey) : null,
              noIndex: r.noIndex,
            },
          ]),
        ),
        robots: {
          allowIndexing: s.allowIndexing,
          disallow: [...new Set([...ALWAYS_DISALLOWED, ...s.robotsDisallow])],
        },
      };
    });
  }

  /** Public URLs for sitemap.xml: only what is published, enabled and indexable. */
  sitemap(): Promise<SitemapEntry[]> {
    return this.cache.get('sitemap', 600, async () => {
      const s = await this.row();
      if (!s.allowIndexing) return [];
      const on = new Set(s.sitemapSections);
      const now = new Date();
      const noIndexRoutes = new Set(
        (
          await this.prisma.seoRoute.findMany({ where: { noIndex: true }, select: { path: true } })
        ).map((r) => r.path),
      );
      const entries: SitemapEntry[] = [];
      const add = (path: string, at: Date | null) => {
        if (entries.length < SITEMAP_LIMIT) entries.push({ path, lastModified: iso(at) });
      };
      const staticRoutes: [string, boolean][] = [
        ['/', true],
        ['/properties', on.has('properties')],
        ['/experiences', true],
        ['/events', on.has('events')],
        ['/tours', on.has('tours')],
        ['/hotels', on.has('hotels')],
        ['/cleaning', on.has('cleaning')],
        ['/destinations', on.has('destinations')],
        ['/blog', on.has('blog') && s.blogEnabled],
        ['/help', on.has('help') && s.helpCenterEnabled],
        ['/careers', on.has('careers') && s.careersEnabled],
      ];
      for (const [path, include] of staticRoutes) {
        if (include && !noIndexRoutes.has(path)) add(path, null);
      }

      if (on.has('properties')) {
        const rows = await this.prisma.property.findMany({
          where: PUBLIC_PROPERTY_WHERE,
          select: { slug: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
          take: 20_000,
        });
        for (const r of rows) add(`/properties/${r.slug}`, r.updatedAt);
      }
      const kinds = [
        ['EVENT', 'events'],
        ['TOUR', 'tours'],
        ['HOTEL', 'hotels'],
        ['CLEANING', 'cleaning'],
      ] as const;
      for (const [kind, segment] of kinds) {
        if (!on.has(segment)) continue;
        const rows = await this.prisma.experience.findMany({
          where: { ...PUBLIC_EXPERIENCE_WHERE, kind },
          select: { slug: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
          take: 5_000,
        });
        for (const r of rows) add(`/${segment}/${r.slug}`, r.updatedAt);
      }
      if (on.has('destinations')) {
        const rows = await this.prisma.vacationZone.findMany({
          where: { published: true },
          select: { slug: true, updatedAt: true },
        });
        for (const r of rows) add(`/destinations/${r.slug}`, r.updatedAt);
      }
      if (on.has('blog') && s.blogEnabled) {
        const rows = await this.prisma.blogPost.findMany({
          where: { status: 'PUBLISHED', publishAt: { lte: now }, noIndex: false },
          select: { slug: true, updatedAt: true },
          orderBy: { publishAt: 'desc' },
          take: 5_000,
        });
        for (const r of rows) add(`/blog/${r.slug}`, r.updatedAt);
      }
      if (on.has('help') && s.helpCenterEnabled) {
        const rows = await this.prisma.helpArticle.findMany({
          where: { status: 'PUBLISHED' },
          select: { slug: true, updatedAt: true },
        });
        for (const r of rows) add(`/help/${r.slug}`, r.updatedAt);
      }
      if (on.has('careers') && s.careersEnabled) {
        const rows = await this.prisma.jobPosting.findMany({
          where: { status: 'PUBLISHED' },
          select: { slug: true, updatedAt: true },
        });
        for (const r of rows) add(`/careers/${r.slug}`, r.updatedAt);
      }
      if (on.has('pages')) {
        const rows = await this.prisma.page.findMany({
          where: { status: 'PUBLISHED', noIndex: false },
          select: { slug: true, system: true, updatedAt: true },
        });
        for (const r of rows) add(r.system ? `/${r.slug}` : `/pages/${r.slug}`, r.updatedAt);
      }
      return entries;
    });
  }
}

function pick(row: object, keys: string[]): Prisma.InputJsonValue {
  const source = row as Record<string, unknown>;
  return Object.fromEntries(keys.map((k) => [k, source[k] ?? null]));
}

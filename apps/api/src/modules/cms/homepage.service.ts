import { Injectable } from '@nestjs/common';
import {
  HOMEPAGE_SECTIONS,
  homepageConfigSchema,
  homepageSectionDefinition,
  type AdminHomepageSection,
  type ExperienceKind,
  type HomepageSectionKey,
  type HomepageSectionView,
  type updateHomepageSectionSchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { Prisma, type HomepageSection } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { ExperienceSearchService } from '../experiences/experience-search.service';
import { VacationZonesService } from '../experiences/vacation-zones.service';
import { toPropertyCard } from '../properties/property.mapper';
import { PROPERTY_CARD_SELECT, PUBLIC_PROPERTY_WHERE } from '../properties/property.selects';
import { BlogService } from './blog.service';
import { CmsCacheService } from './cms-cache.service';
import { assertMediaExists, toCmsImage, validationError } from './cms-helpers';
import { SiteService } from './site.service';

type Out<T extends z.ZodType> = z.output<T>;

const EXPERIENCE_SECTIONS: Partial<Record<HomepageSectionKey, ExperienceKind>> = {
  HOTELS: 'HOTEL',
  EVENTS: 'EVENT',
  TOURS: 'TOUR',
  CLEANING: 'CLEANING',
};

/**
 * The homepage builder (§37/§55). Each section has an on/off switch, an
 * order, a heading and validated settings. Public rendering only includes
 * sections that are enabled, available (their feature exists) and — for
 * listing sections — have something to show. All listing data comes from
 * the existing public queries, so nothing private can appear here.
 */
@Injectable()
export class HomepageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly cache: CmsCacheService,
    private readonly site: SiteService,
    private readonly blog: BlogService,
    private readonly experiences: ExperienceSearchService,
    private readonly zones: VacationZonesService,
  ) {}

  async adminSections(): Promise<AdminHomepageSection[]> {
    const rows = await this.prisma.homepageSection.findMany({ orderBy: { sortOrder: 'asc' } });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const heroImage = await this.heroImage(byKey.get('HERO'));
    return HOMEPAGE_SECTIONS.map((def, index) => {
      const row = byKey.get(def.key);
      return {
        ...(def.key === 'HERO' ? { heroImage } : {}),
        key: def.key,
        label: def.label,
        available: def.available,
        unavailableReason: def.unavailableReason ?? null,
        enabled: def.available && (row?.enabled ?? false),
        sortOrder: row?.sortOrder ?? index,
        title: row?.title ?? null,
        subtitle: row?.subtitle ?? null,
        config: (row?.config ?? {}) as Record<string, unknown>,
      };
    }).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async update(
    actorId: string,
    key: HomepageSectionKey,
    input: Out<typeof updateHomepageSectionSchema>,
    meta: RequestMeta,
  ): Promise<AdminHomepageSection[]> {
    const def = homepageSectionDefinition(key);
    if (!def) throw Errors.notFound('Section');
    if (input.enabled && !def.available) {
      throw validationError(
        'enabled',
        def.unavailableReason ?? 'This section is not available yet',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.homepageSection.findUnique({ where: { key } });
      let config: Prisma.InputJsonValue | undefined;
      if (input.config !== undefined) {
        const parsed = homepageConfigSchema(key).safeParse(input.config);
        if (!parsed.success) {
          const issue = parsed.error.issues[0]!;
          throw validationError(['config', ...issue.path].join('.'), issue.message);
        }
        config = parsed.data;
        if (key === 'HERO') {
          await assertMediaExists(
            tx,
            (parsed.data as { imageId?: string | null }).imageId,
            'config.imageId',
          );
        }
      }
      const data = {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.subtitle !== undefined ? { subtitle: input.subtitle } : {}),
        ...(config !== undefined ? { config } : {}),
      };
      await tx.homepageSection.upsert({
        where: { key },
        create: { key, sortOrder: HOMEPAGE_SECTIONS.findIndex((s) => s.key === key), ...data },
        update: data,
      });
      await this.audit.record(
        {
          actorId,
          action: 'cms.homepage.section_updated',
          resourceType: 'homepage_section',
          resourceId: key,
          before: current ? { enabled: current.enabled } : undefined,
          after: {
            fields: Object.keys(input),
            enabled: input.enabled ?? current?.enabled ?? false,
          },
          meta,
        },
        tx,
      );
    });
    await this.cache.invalidate();
    return this.adminSections();
  }

  async reorder(actorId: string, keys: HomepageSectionKey[], meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      for (const [sortOrder, key] of keys.entries()) {
        await tx.homepageSection.upsert({
          where: { key },
          create: { key, sortOrder },
          update: { sortOrder },
        });
      }
      await this.audit.record(
        {
          actorId,
          action: 'cms.homepage.reordered',
          resourceType: 'homepage_section',
          after: { keys },
          meta,
        },
        tx,
      );
    });
    await this.cache.invalidate();
    return this.adminSections();
  }

  /** The public homepage: enabled, available sections with their data, in order. */
  publicHomepage(): Promise<HomepageSectionView[]> {
    return this.cache.get('homepage', 60, async () => {
      const [rows, site] = await Promise.all([
        this.prisma.homepageSection.findMany({
          where: { enabled: true },
          orderBy: { sortOrder: 'asc' },
        }),
        this.site.row(),
      ]);
      const views: HomepageSectionView[] = [];
      for (const row of rows) {
        const def = homepageSectionDefinition(row.key);
        if (!def?.available) continue;
        const view = await this.render(row, site.blogEnabled);
        if (view) views.push(view);
      }
      return views;
    });
  }

  /** The hero's library image; a missing one (deleted outside the app) is just no image. */
  private async heroImage(row: HomepageSection | undefined) {
    const id = (row?.config as { imageId?: unknown } | undefined)?.imageId;
    if (typeof id !== 'string') return null;
    const media = await this.prisma.cmsMedia.findUnique({ where: { id } });
    return media ? toCmsImage(media, this.storage) : null;
  }

  private async render(
    row: HomepageSection,
    blogEnabled: boolean,
  ): Promise<HomepageSectionView | null> {
    const parsed = homepageConfigSchema(row.key).safeParse(row.config);
    // Settings that no longer validate (e.g. after a schema change) hide the section.
    if (!parsed.success) return null;
    const config = parsed.data as Record<string, unknown>;
    const head = { title: row.title, subtitle: row.subtitle };
    const limit = (config.limit as number | undefined) ?? 6;

    switch (row.key) {
      case 'HERO':
        return {
          key: 'HERO',
          ...head,
          eyebrow: (config.eyebrow as string | null | undefined) ?? null,
          showSearch: config.showSearch as boolean,
          searchPlaceholder: (config.searchPlaceholder as string | null | undefined) ?? null,
          links: config.links as { label: string; href: string }[],
          image: await this.heroImage(row),
          imageLayout: config.imageLayout as 'BACKGROUND' | 'SIDE',
          overlay: config.overlay as 'LIGHT' | 'MEDIUM' | 'STRONG',
        };
      case 'EXPLORE': {
        const items = config.items as {
          title: string;
          description?: string | null;
          href: string;
        }[];
        if (!items.length) return null;
        return {
          key: 'EXPLORE',
          ...head,
          items: items.map((i) => ({
            title: i.title,
            description: i.description ?? null,
            href: i.href,
          })),
        };
      }
      case 'CTA': {
        if (!row.title) return null;
        return {
          key: 'CTA',
          ...head,
          button: (config.button as { label: string; href: string } | null) ?? null,
        };
      }
      case 'FEATURED_PROPERTIES':
      case 'RENT_PROPERTIES':
      case 'SALE_PROPERTIES':
      case 'SPECIAL_OFFERS': {
        const where =
          row.key === 'FEATURED_PROPERTIES'
            ? { ...PUBLIC_PROPERTY_WHERE, featuredAt: { not: null } }
            : row.key === 'SPECIAL_OFFERS'
              ? // Listings the agent has discounted, biggest discount first.
                { ...PUBLIC_PROPERTY_WHERE, discountPercent: { gte: 1 } }
              : {
                  ...PUBLIC_PROPERTY_WHERE,
                  listingType:
                    row.key === 'RENT_PROPERTIES' ? ('RENT' as const) : ('SALE' as const),
                };
        const properties = await this.prisma.property.findMany({
          where,
          orderBy:
            row.key === 'FEATURED_PROPERTIES'
              ? [{ featuredAt: 'desc' }, { id: 'asc' }]
              : row.key === 'SPECIAL_OFFERS'
                ? [{ discountPercent: 'desc' }, { publishedAt: 'desc' }, { id: 'asc' }]
                : [{ publishedAt: 'desc' }, { id: 'asc' }],
          take: limit,
          select: PROPERTY_CARD_SELECT,
        });
        if (!properties.length) return null;
        return {
          key: row.key,
          ...head,
          properties: properties.map((p) => toPropertyCard(p, this.storage)),
        };
      }
      case 'POPULAR_LOCATIONS': {
        const groups = await this.prisma.property.groupBy({
          by: ['city', 'state'],
          where: PUBLIC_PROPERTY_WHERE,
          _count: { _all: true },
          orderBy: { _count: { id: 'desc' } },
          take: limit,
        });
        const locations = groups
          .filter((g) => g.city && g.state)
          .map((g) => ({ city: g.city!, state: g.state!, count: g._count._all }));
        if (!locations.length) return null;
        return { key: 'POPULAR_LOCATIONS', ...head, locations };
      }
      case 'VACATION_ZONES': {
        const zones = await this.zones.list({ page: 1, pageSize: limit });
        if (!zones.items.length) return null;
        return { key: 'VACATION_ZONES', ...head, zones: zones.items };
      }
      case 'HOTELS':
      case 'EVENTS':
      case 'TOURS':
      case 'CLEANING': {
        const kind = EXPERIENCE_SECTIONS[row.key]!;
        const result = await this.experiences.search({
          kind,
          page: 1,
          pageSize: limit,
          when: 'upcoming',
          sort: kind === 'EVENT' ? 'soonest' : 'newest',
        });
        if (!result.items.length) return null;
        return { key: row.key, ...head, experiences: result.items };
      }
      case 'BLOG': {
        if (!blogEnabled) return null;
        const posts = await this.blog.latestCards(limit);
        if (!posts.length) return null;
        return { key: 'BLOG', ...head, posts };
      }
      case 'TESTIMONIALS': {
        const rows = await this.prisma.testimonial.findMany({
          where: { published: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          take: limit,
          include: { photo: true },
        });
        if (!rows.length) return null;
        return {
          key: 'TESTIMONIALS',
          ...head,
          testimonials: rows.map((t) => ({
            id: t.id,
            quote: t.quote,
            authorName: t.authorName,
            authorRole: t.authorRole,
            photo: t.photo ? toCmsImage(t.photo, this.storage) : null,
          })),
        };
      }
      case 'AWARDS': {
        // Holders of the chosen badge (or any active badge), best rated, then most stayed.
        const badgeId = (config.badgeId as string | null | undefined) ?? null;
        const ids = await this.prisma.$queryRaw<{ id: string }[]>`
          SELECT p.id FROM properties p
          WHERE EXISTS (
            SELECT 1 FROM badge_awards a JOIN badges b ON b.id = a.badge_id
            WHERE a.property_id = p.id AND b.active
              ${badgeId ? Prisma.sql`AND b.id = ${badgeId}::uuid` : Prisma.empty}
          )
          ORDER BY p.rating_sum::float / NULLIF(p.review_count, 0) DESC NULLS LAST,
                   p.completed_bookings DESC, p.id
          LIMIT 200`;
        const rows = await this.prisma.property.findMany({
          where: { ...PUBLIC_PROPERTY_WHERE, id: { in: ids.map((r) => r.id) } },
          select: PROPERTY_CARD_SELECT,
        });
        const order = new Map(ids.map((r, i) => [r.id, i]));
        const properties = rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!).slice(0, limit);
        if (!properties.length) return null;
        return {
          key: 'AWARDS',
          ...head,
          properties: properties.map((p) => toPropertyCard(p, this.storage)),
        };
      }
      default:
        return null;
    }
  }
}

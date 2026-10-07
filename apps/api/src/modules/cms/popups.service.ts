import { Injectable } from '@nestjs/common';
import {
  ctaComplete,
  type AdminPopupView,
  type Paginated,
  type PopupAudience,
  type PopupFrequency,
  type PopupKind,
  type PublicPopupView,
  type createPopupSchema,
  type popupEventSchema,
  type updatePopupSchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { koboToNumber } from '../../common/money';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { PUBLIC_PROPERTY_WHERE } from '../properties/property.selects';
import { CmsCacheService } from './cms-cache.service';
import { assertMediaExists, toCmsImage, validationError } from './cms-helpers';

type Out<T extends z.ZodType> = z.output<T>;
type Tx = Prisma.TransactionClient;

const INCLUDE = {
  image: true,
  property: {
    include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } },
  },
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.PopupInclude;
type Row = Prisma.PopupGetPayload<{ include: typeof INCLUDE }>;

const COUNTER = { VIEW: 'views', CLICK: 'clicks', DISMISS: 'dismissals' } as const;

/**
 * Pop-ups on the public site. The public list is cached (CMS cache, short
 * TTL) and invalidated on every change; the browser picks which one to show
 * (audience, page, schedule, how often). Counters are best-effort analytics.
 */
@Injectable()
export class PopupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly cache: CmsCacheService,
  ) {}

  /** Active, not yet ended; property pop-ups only while the property is public. */
  publicList(): Promise<PublicPopupView[]> {
    return this.cache.get('popups', 60, async () => {
      const now = new Date();
      const rows = await this.prisma.popup.findMany({
        where: {
          active: true,
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        take: 50,
        include: INCLUDE,
      });
      const visible = rows.filter((r) => r.kind !== 'PROPERTY' || r.propertyId);
      const publicIds = new Set(
        (
          await this.prisma.property.findMany({
            where: {
              ...PUBLIC_PROPERTY_WHERE,
              id: { in: visible.flatMap((r) => (r.propertyId ? [r.propertyId] : [])) },
            },
            select: { id: true },
          })
        ).map((p) => p.id),
      );
      return visible
        .filter((r) => r.kind !== 'PROPERTY' || publicIds.has(r.propertyId!))
        .map((r) => this.publicView(r, r.propertyId ? publicIds.has(r.propertyId) : false));
    });
  }

  /** Never reveals whether the pop-up exists; unknown or inactive ids change nothing. */
  async record(id: string, input: Out<typeof popupEventSchema>): Promise<void> {
    const column = Prisma.raw(`"${COUNTER[input.type]}"`);
    await this.prisma.$executeRaw`
      UPDATE popups SET ${column} = ${column} + 1 WHERE id = ${id}::uuid AND active`;
  }

  // ── Administration ──

  async list(page: number, pageSize: number): Promise<Paginated<AdminPopupView>> {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.popup.count(),
      this.prisma.popup.findMany({
        orderBy: [{ active: 'desc' }, { priority: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: INCLUDE,
      }),
    ]);
    return {
      items: rows.map((r) => this.adminView(r)),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async get(id: string): Promise<AdminPopupView> {
    const row = await this.prisma.popup.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw Errors.notFound('Pop-up');
    return this.adminView(row);
  }

  async create(
    actorId: string,
    input: Out<typeof createPopupSchema>,
    meta: RequestMeta,
  ): Promise<AdminPopupView> {
    const row = await this.prisma.$transaction(async (tx) => {
      await assertMediaExists(tx, input.imageId, 'imageId');
      const propertyId = await this.propertyId(tx, input.property);
      const created = await tx.popup.create({
        data: {
          ...columns(input),
          name: input.name,
          kind: input.kind,
          title: input.title,
          propertyId,
          createdById: actorId,
        },
        include: INCLUDE,
      });
      await this.audit.record(
        {
          actorId,
          action: 'cms.popup.created',
          resourceType: 'popup',
          resourceId: created.id,
          after: snapshot(created),
          meta,
        },
        tx,
      );
      return created;
    });
    await this.cache.invalidate();
    return this.adminView(row);
  }

  async update(
    actorId: string,
    id: string,
    input: Out<typeof updatePopupSchema>,
    meta: RequestMeta,
  ): Promise<AdminPopupView> {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await tx.popup.findUnique({ where: { id } });
      if (!current) throw Errors.notFound('Pop-up');
      await assertMediaExists(tx, input.imageId, 'imageId');
      const propertyId =
        input.property === undefined ? undefined : await this.propertyId(tx, input.property);
      const merged = {
        kind: input.kind ?? current.kind,
        ctaLabel: input.ctaLabel === undefined ? current.ctaLabel : input.ctaLabel,
        ctaLink: input.ctaLink === undefined ? current.ctaLink : input.ctaLink,
        propertyId: propertyId === undefined ? current.propertyId : propertyId,
        startsAt: input.startsAt === undefined ? current.startsAt : input.startsAt,
        endsAt: input.endsAt === undefined ? current.endsAt : input.endsAt,
      };
      if (!ctaComplete(merged)) {
        throw validationError('ctaLink', 'A button needs both a label and a link');
      }
      if (merged.kind === 'PROPERTY' && !merged.propertyId) {
        throw validationError('property', 'Choose the property to feature');
      }
      if (merged.startsAt && merged.endsAt && merged.startsAt >= merged.endsAt) {
        throw validationError('endsAt', 'The end must be after the start');
      }
      const updated = await tx.popup.update({
        where: { id },
        data: {
          ...columns(input),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(propertyId !== undefined ? { propertyId } : {}),
        },
        include: INCLUDE,
      });
      await this.audit.record(
        {
          actorId,
          action: 'cms.popup.updated',
          resourceType: 'popup',
          resourceId: id,
          before: snapshot(current),
          after: snapshot(updated),
          meta,
        },
        tx,
      );
      return updated;
    });
    await this.cache.invalidate();
    return this.adminView(row);
  }

  async remove(actorId: string, id: string, meta: RequestMeta): Promise<{ deleted: true }> {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.popup.findUnique({ where: { id } });
      if (!row) throw Errors.notFound('Pop-up');
      await tx.popup.delete({ where: { id } });
      await this.audit.record(
        {
          actorId,
          action: 'cms.popup.deleted',
          resourceType: 'popup',
          resourceId: id,
          before: snapshot(row),
          meta,
        },
        tx,
      );
    });
    await this.cache.invalidate();
    return { deleted: true };
  }

  /** A property chosen by slug; it may be unpublished now (then the pop-up stays hidden). */
  private async propertyId(tx: Tx, slug: string | null | undefined): Promise<string | null> {
    if (!slug) return null;
    const property = await tx.property.findUnique({ where: { slug }, select: { id: true } });
    if (!property) throw validationError('property', 'No property has that address');
    return property.id;
  }

  private publicView(row: Row, propertyPublic: boolean): PublicPopupView {
    const property = propertyPublic ? row.property : null;
    const cover = property?.images[0];
    return {
      id: row.id,
      version: row.updatedAt.toISOString(),
      kind: row.kind as PopupKind,
      title: row.title,
      body: row.body,
      image: row.image ? toCmsImage(row.image, this.storage) : null,
      property: property
        ? {
            slug: property.slug,
            title: property.title,
            city: property.city,
            state: property.state,
            priceKobo: property.priceKobo === null ? null : koboToNumber(property.priceKobo),
            pricingPeriod: property.pricingPeriod,
            discountPercent: property.discountPercent,
            imageUrl: cover ? this.storage.url(cover.storageKey) : null,
          }
        : null,
      discountCode: row.discountCode,
      ctaLabel: row.ctaLabel,
      ctaLink: row.ctaLink,
      audience: row.audience as PopupAudience,
      paths: row.paths,
      frequency: row.frequency as PopupFrequency,
      delaySeconds: row.delaySeconds,
      priority: row.priority,
      startsAt: row.startsAt?.toISOString() ?? null,
      endsAt: row.endsAt?.toISOString() ?? null,
    };
  }

  private adminView(row: Row): AdminPopupView {
    return {
      ...this.publicView(row, row.property !== null),
      name: row.name,
      active: row.active,
      propertySlug: row.property?.slug ?? null,
      views: row.views,
      clicks: row.clicks,
      dismissals: row.dismissals,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/** Optional columns shared by create and update (undefined = unchanged). */
function columns(input: Partial<Out<typeof createPopupSchema>>) {
  const data: Prisma.PopupUncheckedUpdateInput = {};
  const keys = [
    'body',
    'imageId',
    'discountCode',
    'ctaLabel',
    'ctaLink',
    'audience',
    'paths',
    'frequency',
    'delaySeconds',
    'priority',
    'active',
    'startsAt',
    'endsAt',
  ] as const;
  for (const key of keys) {
    if (input[key] !== undefined) (data as Record<string, unknown>)[key] = input[key];
  }
  return data as Prisma.PopupUncheckedCreateInput;
}

const snapshot = (r: {
  name: string;
  kind: string;
  title: string;
  active: boolean;
  audience: string;
  paths: string[];
  startsAt: Date | null;
  endsAt: Date | null;
  propertyId: string | null;
  discountCode: string | null;
  ctaLink: string | null;
}) => ({
  name: r.name,
  kind: r.kind,
  title: r.title,
  active: r.active,
  audience: r.audience,
  paths: r.paths,
  startsAt: r.startsAt?.toISOString() ?? null,
  endsAt: r.endsAt?.toISOString() ?? null,
  propertyId: r.propertyId,
  discountCode: r.discountCode,
  ctaLink: r.ctaLink,
});

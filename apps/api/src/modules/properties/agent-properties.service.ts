import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  PropertyStatus,
  type AgentPropertyListItem,
  type AgentPropertyView,
  type createPropertySchema,
  type updatePropertySchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { AppException } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import type { AgentProfile, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { PlanLimitsService } from '../plans/plan-limits.service';
import { PropertyAccessService } from './property-access.service';
import { AGENT_SUBMITTABLE, missingForSubmission } from './property-lifecycle';
import { toAgentPropertyListItem, toAgentPropertyView } from './property.mapper';
import { AGENT_PROPERTY_INCLUDE, type AgentPropertyRow } from './property.selects';
import { propertySlug } from './slug';

type CreateInput = z.output<typeof createPropertySchema>;
type UpdateInput = z.output<typeof updatePropertySchema>;
type Tx = Prisma.TransactionClient;
/** Scalar column values shared by create and update. */
type Columns = Prisma.PropertyUncheckedUpdateInput;

@Injectable()
export class AgentPropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PropertyAccessService,
    private readonly plans: PlanLimitsService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async list(userId: string): Promise<AgentPropertyListItem[]> {
    const agent = await this.access.agentFor(userId);
    const rows = await this.prisma.property.findMany({
      where: { agentProfileId: agent.id },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        moderationNote: true,
        propertyType: true,
        listingType: true,
        pricingPeriod: true,
        priceKobo: true,
        city: true,
        state: true,
        updatedAt: true,
        images: { where: { isPrimary: true }, take: 1, select: { thumbnailKey: true } },
        _count: { select: { favorites: true } },
      },
    });
    const views = await this.viewTotals(rows.map((r) => r.id));
    return rows.map((row) => toAgentPropertyListItem(row, views.get(row.id) ?? 0, this.storage));
  }

  async get(userId: string, propertyId: string): Promise<AgentPropertyView> {
    const agent = await this.access.agentFor(userId);
    return this.view(await this.access.owned(agent.id, propertyId));
  }

  async create(userId: string, input: CreateInput, meta: RequestMeta): Promise<AgentPropertyView> {
    const agent = await this.access.agentFor(userId);
    this.access.assertCanManage(agent);

    const property = await this.prisma.$transaction(async (tx) => {
      await this.plans.assertCanAddProperty(tx, agent.id);
      await assertActiveAmenities(tx, input.amenityIds);
      const { amenityIds, ...fields } = input;
      const created = await tx.property.create({
        data: {
          // Validated scalars only: toColumns never emits relation or ownership fields.
          ...(toColumns(fields) as Omit<
            Prisma.PropertyUncheckedCreateInput,
            'agentProfileId' | 'slug'
          >),
          title: input.title,
          propertyType: input.propertyType,
          listingType: input.listingType,
          pricingPeriod: input.listingType === 'SALE' ? 'SALE' : (input.pricingPeriod ?? null),
          slug: propertySlug(input.title),
          // Ownership always comes from the session, never from the request body.
          agentProfileId: agent.id,
          status: PropertyStatus.DRAFT,
          amenities: amenityIds?.length
            ? { create: amenityIds.map((amenityId) => ({ amenityId })) }
            : undefined,
        },
        include: AGENT_PROPERTY_INCLUDE,
      });
      await this.audit.record(
        {
          actorId: userId,
          action: 'property.created',
          resourceType: 'property',
          resourceId: created.id,
          meta,
        },
        tx,
      );
      return created;
    });
    return this.view(property);
  }

  /**
   * Updates content. Editing a published listing sends it back to review, so
   * nothing reaches the public without moderation.
   */
  async update(
    userId: string,
    propertyId: string,
    input: UpdateInput,
    meta: RequestMeta,
  ): Promise<AgentPropertyView> {
    const agent = await this.access.agentFor(userId);
    this.access.assertCanManage(agent);

    const property = await this.prisma.$transaction(async (tx) => {
      const current = await this.access.owned(agent.id, propertyId, tx);
      this.access.assertEditable(current.status);
      const wasPublished = current.status === PropertyStatus.PUBLISHED;
      if (wasPublished) this.access.assertVerified(agent);

      const { amenityIds, ...fields } = input;
      const data = toColumns(fields);
      reconcile(current, data);

      if (input.title && input.title !== current.title && !current.publishedAt) {
        data.slug = propertySlug(input.title);
      }
      if (wasPublished) {
        data.status = PropertyStatus.PENDING_REVIEW;
        data.submittedAt = new Date();
        data.moderationNote = null;
      }
      if (amenityIds) {
        await assertActiveAmenities(tx, amenityIds);
        await tx.propertyAmenity.deleteMany({ where: { propertyId } });
        if (amenityIds.length) {
          await tx.propertyAmenity.createMany({
            data: amenityIds.map((amenityId) => ({ propertyId, amenityId })),
          });
        }
      }

      const updated = await tx.property.update({
        where: { id: propertyId },
        data,
        include: AGENT_PROPERTY_INCLUDE,
      });
      await this.audit.record(
        {
          actorId: userId,
          action: wasPublished ? 'property.edited_after_publish' : 'property.updated',
          resourceType: 'property',
          resourceId: propertyId,
          after: { fields: Object.keys(input) },
          meta,
        },
        tx,
      );
      return updated;
    });
    return this.view(property);
  }

  async submit(userId: string, propertyId: string, meta: RequestMeta): Promise<AgentPropertyView> {
    const agent = await this.access.agentFor(userId);
    this.access.assertVerified(agent);
    return this.transition(
      userId,
      agent,
      propertyId,
      meta,
      (current) => {
        if (!AGENT_SUBMITTABLE.includes(current.status))
          throw invalidTransition('This property cannot be submitted now.');
        const missing = missingForSubmission(current, current.images.length);
        if (missing.length) {
          throw new AppException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            ErrorCode.PROPERTY_INCOMPLETE,
            'Complete the highlighted details before submitting.',
            { missing },
          );
        }
        return {
          status: PropertyStatus.PENDING_REVIEW,
          submittedAt: new Date(),
          moderationNote: null,
        };
      },
      'property.submitted',
    );
  }

  async withdraw(
    userId: string,
    propertyId: string,
    meta: RequestMeta,
  ): Promise<AgentPropertyView> {
    const agent = await this.access.agentFor(userId);
    this.access.assertCanManage(agent);
    return this.transition(
      userId,
      agent,
      propertyId,
      meta,
      (current) => {
        if (current.status !== PropertyStatus.PENDING_REVIEW)
          throw invalidTransition('Only properties awaiting review can be withdrawn.');
        // A listing that was live before this review keeps its review history but returns to draft.
        return { status: PropertyStatus.DRAFT, submittedAt: null };
      },
      'property.withdrawn',
    );
  }

  async archive(userId: string, propertyId: string, meta: RequestMeta): Promise<AgentPropertyView> {
    const agent = await this.access.agentFor(userId);
    this.access.assertCanManage(agent);
    return this.transition(
      userId,
      agent,
      propertyId,
      meta,
      (current) => {
        if (current.status === PropertyStatus.ARCHIVED)
          throw invalidTransition('This property is already archived.');
        if (current.status === PropertyStatus.SUSPENDED) {
          throw invalidTransition(
            'Suspended properties cannot be archived. Please contact support.',
          );
        }
        return { status: PropertyStatus.ARCHIVED, archivedAt: new Date() };
      },
      'property.archived',
    );
  }

  /** Brings an archived property back as a draft, subject to the plan's property allowance. */
  async restore(userId: string, propertyId: string, meta: RequestMeta): Promise<AgentPropertyView> {
    const agent = await this.access.agentFor(userId);
    this.access.assertCanManage(agent);
    return this.transition(
      userId,
      agent,
      propertyId,
      meta,
      async (current, tx) => {
        if (current.status !== PropertyStatus.ARCHIVED)
          throw invalidTransition('Only archived properties can be restored.');
        await this.plans.assertCanAddProperty(tx, agent.id);
        return { status: PropertyStatus.DRAFT, archivedAt: null, submittedAt: null };
      },
      'property.restored',
    );
  }

  private async transition(
    userId: string,
    agent: AgentProfile,
    propertyId: string,
    meta: RequestMeta,
    decide: (current: AgentPropertyRow, tx: Tx) => Columns | Promise<Columns>,
    action: string,
  ): Promise<AgentPropertyView> {
    const property = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM properties WHERE id = ${propertyId}::uuid AND agent_profile_id = ${agent.id}::uuid FOR UPDATE`;
      const current = await this.access.owned(agent.id, propertyId, tx);
      const data = await decide(current, tx);
      const updated = await tx.property.update({
        where: { id: propertyId },
        data,
        include: AGENT_PROPERTY_INCLUDE,
      });
      await this.audit.record(
        {
          actorId: userId,
          action,
          resourceType: 'property',
          resourceId: propertyId,
          before: { status: current.status },
          after: { status: updated.status },
          meta,
        },
        tx,
      );
      return updated;
    });
    return this.view(property);
  }

  async view(row: AgentPropertyRow): Promise<AgentPropertyView> {
    const views = await this.viewTotals([row.id]);
    return toAgentPropertyView(row, views.get(row.id) ?? 0, this.storage);
  }

  private async viewTotals(ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.propertyViewDaily.groupBy({
      by: ['propertyId'],
      where: { propertyId: { in: ids } },
      _sum: { views: true },
    });
    return new Map(rows.map((r) => [r.propertyId, r._sum.views ?? 0]));
  }
}

/** Converts validated input (numbers, ISO dates) to Prisma column values. */
function toColumns(fields: Omit<Partial<UpdateInput>, 'amenityIds'>): Columns {
  const data: Columns = {};
  const assign = <K extends keyof Columns>(key: K, value: Columns[K]) => {
    if (value !== undefined) data[key] = value;
  };
  const big = (v: number | null | undefined) =>
    v === undefined ? undefined : v === null ? null : BigInt(v);

  assign('title', fields.title);
  assign('description', fields.description);
  assign('propertyType', fields.propertyType);
  assign('listingType', fields.listingType);
  assign('pricingPeriod', fields.pricingPeriod);
  assign('addressLine', fields.addressLine);
  assign('city', fields.city);
  assign('lga', fields.lga);
  assign('state', fields.state);
  assign('country', fields.country);
  assign('latitude', fields.latitude);
  assign('longitude', fields.longitude);
  assign('sizeSqm', fields.sizeSqm);
  assign('bedrooms', fields.bedrooms);
  assign('bathrooms', fields.bathrooms);
  assign('toilets', fields.toilets);
  assign('maxGuests', fields.maxGuests);
  assign('parkingSpaces', fields.parkingSpaces);
  assign('furnished', fields.furnished);
  assign('serviced', fields.serviced);
  assign('priceKobo', big(fields.priceKobo));
  assign('currency', fields.currency);
  assign('cautionFeeKobo', big(fields.cautionFeeKobo));
  assign('discountPercent', fields.discountPercent);
  assign('cleaningOption', fields.cleaningOption);
  assign('cleaningFeeKobo', big(fields.cleaningFeeKobo));
  assign(
    'availableFrom',
    fields.availableFrom === undefined
      ? undefined
      : fields.availableFrom
        ? new Date(fields.availableFrom)
        : null,
  );
  return data;
}

/**
 * Keeps cross-field rules true for the *merged* record, not just the patch:
 * switching to SALE forces the SALE period; switching to RENT clears it.
 */
function reconcile(current: AgentPropertyRow, data: Columns): void {
  const listingType = (data.listingType as string | undefined) ?? current.listingType;
  let period =
    data.pricingPeriod !== undefined
      ? (data.pricingPeriod as string | null)
      : current.pricingPeriod;
  if (listingType === 'SALE') period = 'SALE';
  else if (period === 'SALE') period = null;
  if (period !== current.pricingPeriod || data.pricingPeriod !== undefined) {
    data.pricingPeriod = period as Columns['pricingPeriod'];
  }

  const cleaning = data.cleaningOption !== undefined ? data.cleaningOption : current.cleaningOption;
  const fee = data.cleaningFeeKobo !== undefined ? data.cleaningFeeKobo : current.cleaningFeeKobo;
  if (cleaning === 'AVAILABLE_FOR_FEE' && !fee) {
    throw new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      ErrorCode.VALIDATION_ERROR,
      'Please check the highlighted fields.',
      { issues: [{ path: 'cleaningFeeKobo', message: 'Enter the cleaning fee' }] },
    );
  }
}

/** Agents can only attach amenities from the active, admin-managed catalogue. */
async function assertActiveAmenities(tx: Tx, ids: string[] | undefined): Promise<void> {
  if (!ids?.length) return;
  const found = await tx.amenity.count({ where: { id: { in: ids }, isActive: true } });
  if (found !== ids.length) {
    throw new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      ErrorCode.VALIDATION_ERROR,
      'Please check the highlighted fields.',
      { issues: [{ path: 'amenityIds', message: 'Choose amenities from the list' }] },
    );
  }
}

const invalidTransition = (message: string) =>
  new AppException(HttpStatus.CONFLICT, ErrorCode.INVALID_STATUS_TRANSITION, message);

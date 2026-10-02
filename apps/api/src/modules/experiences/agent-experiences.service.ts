import { HttpStatus, Injectable } from '@nestjs/common';
import {
  EXPERIENCE_ENTITLEMENT,
  EXPERIENCE_KINDS,
  ErrorCode,
  ExperienceStatus,
  experienceDetailKey,
  type AgentExperienceList,
  type AgentExperienceView,
  type ExperienceAllowance,
  type ExperienceKind,
  type createExperienceSchema,
  type replaceTicketTypesSchema,
  type replaceTourDatesSchema,
  type updateExperienceSchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { AppException } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import type { AgentProfile, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { COUNTED_EXPERIENCE_STATUSES, PlanLimitsService } from '../plans/plan-limits.service';
import { PropertyAccessService } from '../properties/property-access.service';
import { propertySlug } from '../properties/slug';
import { ExperienceAccessService } from './experience-access.service';
import { AGENT_SUBMITTABLE, missingForSubmission } from './experience-lifecycle';
import {
  submissionFacts,
  toAgentExperienceListItem,
  toAgentExperienceView,
} from './experience.mapper';
import { AGENT_EXPERIENCE_INCLUDE, type AgentExperienceRow } from './experience.selects';

type CreateInput = z.output<typeof createExperienceSchema>;
type UpdateInput = z.output<typeof updateExperienceSchema>;
type Tx = Prisma.TransactionClient;
type Columns = Prisma.ExperienceUncheckedUpdateInput;

/**
 * The signed-in agent's events, tours, hotels and cleaning services. Same
 * lifecycle as properties: draft → submit → admin review → published; edits
 * to a published listing send it back to review. Catalogue only — nothing
 * here takes payment.
 */
@Injectable()
export class AgentExperiencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: PropertyAccessService,
    private readonly access: ExperienceAccessService,
    private readonly plans: PlanLimitsService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async list(userId: string, kind?: ExperienceKind): Promise<AgentExperienceList> {
    const agent = await this.agents.agentFor(userId);
    const [rows, allowances] = await Promise.all([
      this.prisma.experience.findMany({
        where: { agentProfileId: agent.id, ...(kind ? { kind } : {}) },
        orderBy: { updatedAt: 'desc' },
        take: 500,
        select: {
          id: true,
          slug: true,
          kind: true,
          title: true,
          status: true,
          moderationNote: true,
          city: true,
          state: true,
          updatedAt: true,
          images: { where: { isPrimary: true }, take: 1, select: { thumbnailKey: true } },
          event: { select: { startsAt: true } },
        },
      }),
      this.allowances(agent.id),
    ]);
    return { items: rows.map((r) => toAgentExperienceListItem(r, this.storage)), allowances };
  }

  /** Used vs allowed per kind, from the plan in force (null = not limited). */
  async allowances(
    agentProfileId: string,
  ): Promise<Record<ExperienceKind, ExperienceAllowance | null>> {
    const [{ limits }, counts] = await Promise.all([
      this.plans.effectivePlan(agentProfileId),
      this.prisma.experience.groupBy({
        by: ['kind'],
        where: { agentProfileId, status: { in: COUNTED_EXPERIENCE_STATUSES } },
        _count: { _all: true },
      }),
    ]);
    return Object.fromEntries(
      EXPERIENCE_KINDS.map((kind) => {
        const key = EXPERIENCE_ENTITLEMENT[kind];
        const used = counts.find((c) => c.kind === kind)?._count._all ?? 0;
        return [kind, key ? { used, limit: limits[key] } : null];
      }),
    ) as Record<ExperienceKind, ExperienceAllowance | null>;
  }

  async get(userId: string, id: string): Promise<AgentExperienceView> {
    const agent = await this.agents.agentFor(userId);
    return this.view(await this.access.owned(agent.id, id));
  }

  async create(
    userId: string,
    input: CreateInput,
    meta: RequestMeta,
  ): Promise<AgentExperienceView> {
    const agent = await this.agents.agentFor(userId);
    this.agents.assertCanManage(agent);

    const row = await this.prisma.$transaction(async (tx) => {
      // Locks the agent, then checks the kind's allowance (cleaning: never limited).
      await this.plans.assertCanAddExperience(tx, agent.id, input.kind);
      await assertActiveAmenities(tx, input.amenityIds);
      const own = detailColumns(input.kind, input[experienceDetailKey(input.kind)]);
      const created = await tx.experience.create({
        data: {
          ...(commonColumns(input) as Omit<
            Prisma.ExperienceUncheckedCreateInput,
            'agentProfileId' | 'slug' | 'kind' | 'title'
          >),
          kind: input.kind,
          title: input.title,
          slug: propertySlug(input.title),
          // Ownership always comes from the session, never from the request body.
          agentProfileId: agent.id,
          status: ExperienceStatus.DRAFT,
          amenities: input.amenityIds?.length
            ? { create: input.amenityIds.map((amenityId) => ({ amenityId })) }
            : undefined,
          // Every listing has its kind's details row from the start.
          [experienceDetailKey(input.kind)]: { create: own },
        },
        include: AGENT_EXPERIENCE_INCLUDE,
      });
      await this.audit.record(
        {
          actorId: userId,
          action: 'experience.created',
          resourceType: 'experience',
          resourceId: created.id,
          after: { kind: input.kind },
          meta,
        },
        tx,
      );
      return created;
    });
    return this.view(row);
  }

  async update(
    userId: string,
    id: string,
    input: UpdateInput,
    meta: RequestMeta,
  ): Promise<AgentExperienceView> {
    const agent = await this.agents.agentFor(userId);
    this.agents.assertCanManage(agent);

    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.access.ownedEditable(tx, agent.id, id);
      const wasPublished = current.status === ExperienceStatus.PUBLISHED;
      if (wasPublished) this.agents.assertVerified(agent);

      const ownKey = experienceDetailKey(current.kind);
      for (const key of ['event', 'tour', 'hotel', 'cleaning'] as const) {
        if (key !== ownKey && input[key] !== undefined) {
          throw validationError(key, 'Not applicable to this listing');
        }
      }
      const details = input[ownKey];
      if (current.kind === 'EVENT' && input.event) assertEventTimes(current, input.event);

      const data = commonColumns(input);
      if (input.title && input.title !== current.title && !current.publishedAt) {
        data.slug = propertySlug(input.title);
      }
      if (wasPublished) {
        data.status = ExperienceStatus.PENDING_REVIEW;
        data.submittedAt = new Date();
        data.moderationNote = null;
      }
      if (input.amenityIds) {
        await assertActiveAmenities(tx, input.amenityIds);
        await tx.experienceAmenity.deleteMany({ where: { experienceId: id } });
        if (input.amenityIds.length) {
          await tx.experienceAmenity.createMany({
            data: input.amenityIds.map((amenityId) => ({ experienceId: id, amenityId })),
          });
        }
      }
      if (details) {
        const columns = detailColumns(current.kind, details);
        await upsertDetails(tx, current.kind, id, columns);
      }
      const updated = await tx.experience.update({
        where: { id },
        // Touch updatedAt even when only a details row changed.
        data: { ...data, updatedAt: new Date() },
        include: AGENT_EXPERIENCE_INCLUDE,
      });
      await this.audit.record(
        {
          actorId: userId,
          action: wasPublished ? 'experience.edited_after_publish' : 'experience.updated',
          resourceType: 'experience',
          resourceId: id,
          after: { fields: Object.keys(input) },
          meta,
        },
        tx,
      );
      return updated;
    });
    return this.view(row);
  }

  async submit(userId: string, id: string, meta: RequestMeta): Promise<AgentExperienceView> {
    const agent = await this.agents.agentFor(userId);
    this.agents.assertVerified(agent);
    return this.transition(
      userId,
      agent,
      id,
      meta,
      (current) => {
        if (!AGENT_SUBMITTABLE.includes(current.status))
          throw invalidTransition('This listing cannot be submitted now.');
        const missing = missingForSubmission(submissionFacts(current));
        if (missing.length) {
          throw new AppException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            ErrorCode.PROPERTY_INCOMPLETE,
            'Complete the highlighted details before submitting.',
            { missing },
          );
        }
        return {
          status: ExperienceStatus.PENDING_REVIEW,
          submittedAt: new Date(),
          moderationNote: null,
        };
      },
      'experience.submitted',
    );
  }

  async withdraw(userId: string, id: string, meta: RequestMeta): Promise<AgentExperienceView> {
    const agent = await this.agents.agentFor(userId);
    this.agents.assertCanManage(agent);
    return this.transition(
      userId,
      agent,
      id,
      meta,
      (current) => {
        if (current.status !== ExperienceStatus.PENDING_REVIEW)
          throw invalidTransition('Only listings awaiting review can be withdrawn.');
        return { status: ExperienceStatus.DRAFT, submittedAt: null };
      },
      'experience.withdrawn',
    );
  }

  async archive(userId: string, id: string, meta: RequestMeta): Promise<AgentExperienceView> {
    const agent = await this.agents.agentFor(userId);
    this.agents.assertCanManage(agent);
    return this.transition(
      userId,
      agent,
      id,
      meta,
      (current) => {
        if (current.status === ExperienceStatus.ARCHIVED)
          throw invalidTransition('This listing is already archived.');
        if (current.status === ExperienceStatus.SUSPENDED) {
          throw invalidTransition('Suspended listings cannot be archived. Please contact support.');
        }
        return { status: ExperienceStatus.ARCHIVED, archivedAt: new Date() };
      },
      'experience.archived',
    );
  }

  /** Brings an archived listing back as a draft, within the kind's plan allowance. */
  async restore(userId: string, id: string, meta: RequestMeta): Promise<AgentExperienceView> {
    const agent = await this.agents.agentFor(userId);
    this.agents.assertCanManage(agent);
    return this.transition(
      userId,
      agent,
      id,
      meta,
      async (current, tx) => {
        if (current.status !== ExperienceStatus.ARCHIVED)
          throw invalidTransition('Only archived listings can be restored.');
        await this.plans.assertCanAddExperience(tx, agent.id, current.kind);
        return { status: ExperienceStatus.DRAFT, archivedAt: null, submittedAt: null };
      },
      'experience.restored',
    );
  }

  /**
   * Replaces an event's ticket types. These are catalogue definitions with
   * listed prices — no tickets are sold. Public content: a published event
   * goes back to review.
   */
  async replaceTicketTypes(
    userId: string,
    id: string,
    input: z.output<typeof replaceTicketTypesSchema>,
    meta: RequestMeta,
  ): Promise<AgentExperienceView> {
    const agent = await this.agents.agentFor(userId);
    this.agents.assertCanManage(agent);
    return this.edit(userId, agent, id, meta, 'experience.ticket_types_replaced', async (tx, c) => {
      this.access.assertKind(c, 'EVENT');
      await tx.eventTicketType.deleteMany({ where: { eventId: id } });
      if (input.ticketTypes.length) {
        await tx.eventTicketType.createMany({
          data: input.ticketTypes.map((t, index) => ({
            eventId: id,
            kind: t.kind,
            name: t.name,
            description: t.description ?? null,
            priceKobo: BigInt(t.priceKobo),
            sortOrder: index,
          })),
        });
      }
      return true;
    });
  }

  /**
   * Replaces a tour's upcoming dates (its availability). Past dates stay as
   * history. Availability is operational, so a published tour stays live.
   */
  async replaceTourDates(
    userId: string,
    id: string,
    input: z.output<typeof replaceTourDatesSchema>,
    meta: RequestMeta,
  ): Promise<AgentExperienceView> {
    const agent = await this.agents.agentFor(userId);
    this.agents.assertCanManage(agent);
    const now = new Date();
    if (input.dates.some((d) => new Date(d) <= now)) {
      throw validationError('dates', 'Choose dates in the future');
    }
    return this.edit(userId, agent, id, meta, 'experience.tour_dates_replaced', async (tx, c) => {
      this.access.assertKind(c, 'TOUR');
      await tx.tourDate.deleteMany({ where: { tourId: id, startsAt: { gt: now } } });
      if (input.dates.length) {
        await tx.tourDate.createMany({
          data: input.dates.map((d) => ({ tourId: id, startsAt: new Date(d) })),
          skipDuplicates: true,
        });
      }
      return false;
    });
  }

  /**
   * Runs a change to an editable listing under its lock. `change` returns
   * whether it altered moderated public content (published → back to review).
   */
  async edit(
    userId: string,
    agent: AgentProfile,
    id: string,
    meta: RequestMeta,
    action: string,
    change: (tx: Tx, current: AgentExperienceRow) => Promise<boolean>,
  ): Promise<AgentExperienceView> {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.access.ownedEditable(tx, agent.id, id);
      const moderated = await change(tx, current);
      if (moderated && current.status === ExperienceStatus.PUBLISHED) {
        this.agents.assertVerified(agent);
        await this.access.backToReviewIfPublished(tx, current);
      }
      await tx.experience.update({ where: { id }, data: { updatedAt: new Date() } });
      await this.audit.record(
        { actorId: userId, action, resourceType: 'experience', resourceId: id, meta },
        tx,
      );
      return this.access.owned(agent.id, id, tx);
    });
    return this.view(row);
  }

  private async transition(
    userId: string,
    agent: AgentProfile,
    id: string,
    meta: RequestMeta,
    decide: (current: AgentExperienceRow, tx: Tx) => Columns | Promise<Columns>,
    action: string,
  ): Promise<AgentExperienceView> {
    const row = await this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, agent.id, id);
      const current = await this.access.owned(agent.id, id, tx);
      const data = await decide(current, tx);
      const updated = await tx.experience.update({
        where: { id },
        data,
        include: AGENT_EXPERIENCE_INCLUDE,
      });
      await this.audit.record(
        {
          actorId: userId,
          action,
          resourceType: 'experience',
          resourceId: id,
          before: { status: current.status },
          after: { status: updated.status },
          meta,
        },
        tx,
      );
      return updated;
    });
    return this.view(row);
  }

  view(row: AgentExperienceRow): AgentExperienceView {
    return toAgentExperienceView(row, this.storage);
  }
}

/** Shared columns; only validated scalars, never ownership or status. */
function commonColumns(input: Partial<UpdateInput>): Columns {
  const data: Columns = {};
  const assign = <K extends keyof Columns>(key: K, value: Columns[K]) => {
    if (value !== undefined) data[key] = value;
  };
  assign('title', input.title);
  assign('description', input.description);
  assign('addressLine', input.addressLine);
  assign('city', input.city);
  assign('state', input.state);
  assign('latitude', input.latitude);
  assign('longitude', input.longitude);
  return data;
}

type DetailInput = NonNullable<
  UpdateInput['event'] | UpdateInput['tour'] | UpdateInput['hotel'] | UpdateInput['cleaning']
>;

/** Converts a validated details block to its table's columns (dates, BigInt kobo). */
function detailColumns(kind: ExperienceKind, input: DetailInput | undefined) {
  const data: Record<string, unknown> = {};
  if (!input) return data;
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (key === 'priceKobo') data[key] = value === null ? null : BigInt(value as number);
    else if (kind === 'EVENT' && (key === 'startsAt' || key === 'endsAt'))
      data[key] = value === null ? null : new Date(value as string);
    else data[key] = value;
  }
  return data;
}

async function upsertDetails(
  tx: Tx,
  kind: ExperienceKind,
  experienceId: string,
  columns: Record<string, unknown>,
) {
  const args = {
    where: { experienceId },
    create: { experienceId, ...columns },
    update: columns,
  };
  switch (kind) {
    case 'EVENT':
      return tx.event.upsert(args);
    case 'TOUR':
      return tx.tour.upsert(args);
    case 'HOTEL':
      return tx.hotel.upsert(args);
    case 'CLEANING':
      return tx.cleaningService.upsert(args);
  }
}

/** The end must follow the start on the *merged* record, not just the patch. */
function assertEventTimes(
  current: AgentExperienceRow,
  patch: { startsAt?: string | null; endsAt?: string | null },
) {
  const startsAt =
    patch.startsAt !== undefined
      ? patch.startsAt && new Date(patch.startsAt)
      : current.event?.startsAt;
  const endsAt =
    patch.endsAt !== undefined ? patch.endsAt && new Date(patch.endsAt) : current.event?.endsAt;
  if (startsAt && endsAt && endsAt <= startsAt) {
    throw validationError('event.endsAt', 'The event must end after it starts');
  }
}

async function assertActiveAmenities(tx: Tx, ids: string[] | undefined): Promise<void> {
  if (!ids?.length) return;
  const found = await tx.amenity.count({ where: { id: { in: ids }, isActive: true } });
  if (found !== ids.length) throw validationError('amenityIds', 'Choose amenities from the list');
}

export const validationError = (path: string, message: string) =>
  new AppException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    ErrorCode.VALIDATION_ERROR,
    'Please check the highlighted fields.',
    { issues: [{ path, message }] },
  );

const invalidTransition = (message: string) =>
  new AppException(HttpStatus.CONFLICT, ErrorCode.INVALID_STATUS_TRANSITION, message);

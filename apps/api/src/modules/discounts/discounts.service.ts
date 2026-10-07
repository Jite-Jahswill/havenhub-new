import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AccountType,
  DiscountScope,
  ErrorCode,
  NotificationType,
  UserStatus,
  discountLabel,
  type AdminDiscountCodeDetail,
  type AdminDiscountCodeView,
  type AppliedDiscount,
  type Paginated,
  type createDiscountCodeSchema,
  type createPromoCodeSchema,
  type discountCodeListQuerySchema,
  type updateDiscountCodeSchema,
  type updatePromoCodeSchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { AppException, Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { koboToNumber } from '../../common/money';
import { Prisma, type DiscountCode } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { agentDisplayName } from '../properties/property.selects';
import { NotificationsService } from '../notifications/notifications.service';
import { evaluateCode, type UseTarget } from './discount-rules';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * A plan checkout that has not finished within this window no longer holds a
 * use of its code (abandoned payment pages). A booking's use is held until the
 * booking is paid, expires or is cancelled (the booking sweep releases it).
 */
export const PENDING_HOLD_MS = 2 * 3600 * 1000;

/** Uses that count against a code's limits. */
const countedUses = (now: Date) =>
  ({
    OR: [
      { status: 'REDEEMED' },
      { status: 'PENDING', bookingId: { not: null } },
      { status: 'PENDING', createdAt: { gt: new Date(now.getTime() - PENDING_HOLD_MS) } },
    ],
  }) satisfies Prisma.DiscountRedemptionWhereInput;

/** Who is looking at a code: an administrator (plan codes) or the owning agent (promo codes). */
export type CodeViewer = { kind: 'ADMIN' } | { kind: 'AGENT'; agentProfileId: string };

type RedemptionTarget = { subscriptionPaymentId: string } | { bookingId: string };

export type RedemptionStatus = 'PENDING' | 'REDEEMED' | 'RELEASED';

const invalid = (reason: string) =>
  new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.DISCOUNT_CODE_INVALID, reason, {
    issues: [{ path: 'code', message: reason }],
  });

const AGENT_SELECT = {
  id: true,
  businessName: true,
  user: { select: { id: true, fullName: true, email: true } },
} as const;

/**
 * Discount codes: the checkout side (validate, reserve, settle) for agent
 * plans and property bookings, the administrators' plan codes, and agents'
 * own promo codes for their properties.
 */
@Injectable()
export class DiscountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Checkout ──

  /**
   * Validates `code` for this use and returns the discount on `priceKobo`.
   * With `lock` (inside the checkout transaction) the code row is locked so
   * concurrent checkouts cannot both take its last use.
   */
  async apply(
    db: Db,
    input: {
      code: string;
      /** Null on anonymous quotes: per-person limits are checked when booking. */
      userId: string | null;
      target: UseTarget;
      priceKobo: number;
      lock?: boolean;
    },
  ): Promise<{ discountCodeId: string; applied: AppliedDiscount }> {
    const ownerKey = input.target.kind === 'PLAN' ? 'PLATFORM' : input.target.ownerAgentProfileId;
    if (input.lock) {
      await db.$queryRaw`SELECT id FROM discount_codes WHERE owner_key = ${ownerKey} AND code = ${input.code} FOR UPDATE`;
    }
    const row = await db.discountCode.findUnique({
      where: { ownerKey_code: { ownerKey, code: input.code } },
    });
    const now = new Date();
    const counted = row ? await this.usage(db, row.id, input.userId, now) : null;
    const amountOff = (r: DiscountCode) =>
      r.amountOffKobo === null ? null : koboToNumber(r.amountOffKobo);
    const result = evaluateCode(
      row && counted
        ? {
            ...row,
            amountOffKobo: amountOff(row),
            usedTotal: counted.total,
            usedByUser: counted.byUser,
          }
        : null,
      { target: input.target, priceKobo: input.priceKobo, now },
    );
    if (!result.ok) throw invalid(result.reason);
    return {
      discountCodeId: row!.id,
      applied: {
        code: row!.code,
        label: discountLabel({ percentOff: row!.percentOff, amountOffKobo: amountOff(row!) }),
        amountOffKobo: result.amountOffKobo,
      },
    };
  }

  /** Holds one use for an unpaid plan payment or booking. */
  async reserve(
    tx: Prisma.TransactionClient,
    input: { discountCodeId: string; userId: string; amountOffKobo: number } & RedemptionTarget,
  ): Promise<void> {
    await tx.discountRedemption.create({
      data: { ...input, amountOffKobo: BigInt(input.amountOffKobo), status: 'PENDING' },
    });
  }

  /** Paid (REDEEMED), or failed / expired / cancelled (RELEASED). No-op without a code. */
  async settle(
    tx: Prisma.TransactionClient,
    target: RedemptionTarget,
    status: Exclude<RedemptionStatus, 'PENDING'>,
  ): Promise<void> {
    await tx.discountRedemption.updateMany({
      where: { ...target, status: { not: status } },
      data: { status },
    });
  }

  private async usage(db: Db, discountCodeId: string, userId: string | null, now: Date) {
    const counts = { discountCodeId, ...countedUses(now) };
    const [total, byUser] = await Promise.all([
      db.discountRedemption.count({ where: counts }),
      userId ? db.discountRedemption.count({ where: { ...counts, userId } }) : 0,
    ]);
    return { total, byUser };
  }

  // ── Administration ──

  async list(
    query: z.output<typeof discountCodeListQuerySchema>,
    viewer: CodeViewer = { kind: 'ADMIN' },
  ): Promise<Paginated<AdminDiscountCodeView>> {
    const where: Prisma.DiscountCodeWhereInput = {
      ...ownedBy(viewer),
      ...(query.search ? { code: { contains: query.search.toUpperCase() } } : {}),
      ...(query.status ? { active: query.status === 'ACTIVE' } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.discountCode.count({ where }),
      this.prisma.discountCode.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: await this.views(rows),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  /** A code with its uses; someone else's code looks like "not found". */
  async get(id: string, viewer: CodeViewer = { kind: 'ADMIN' }): Promise<AdminDiscountCodeDetail> {
    const row = await this.prisma.discountCode.findFirst({ where: { id, ...ownedBy(viewer) } });
    if (!row) throw Errors.notFound('Discount code');
    const [view] = await this.views([row]);
    const redemptions = await this.prisma.discountRedemption.findMany({
      where: { discountCodeId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        user: { select: { fullName: true, email: true } },
        subscriptionPayment: { select: { reference: true, planName: true } },
        booking: { select: { reference: true, propertySnapshot: true } },
      },
    });
    return {
      ...view!,
      redemptions: redemptions.map((r) => ({
        id: r.id,
        // Agents see their customers' names, not their email addresses.
        user: { name: r.user.fullName, email: viewer.kind === 'ADMIN' ? r.user.email : null },
        amountOffKobo: koboToNumber(r.amountOffKobo),
        status: r.status as RedemptionStatus,
        reference: r.subscriptionPayment?.reference ?? r.booking?.reference ?? '',
        item:
          r.subscriptionPayment?.planName ??
          (r.booking?.propertySnapshot as { title?: string } | undefined)?.title ??
          '',
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /** An agent's promo code for their own properties (they fund the discount). */
  async createPromo(
    actor: AuthContext,
    agentProfileId: string,
    input: z.output<typeof createPromoCodeSchema>,
    meta: RequestMeta,
  ): Promise<AdminDiscountCodeDetail> {
    const propertyIds = [...new Set(input.propertyIds ?? [])];
    if (propertyIds.length > 0) {
      const owned = await this.prisma.property.count({
        where: { id: { in: propertyIds }, agentProfileId },
      });
      if (owned !== propertyIds.length) {
        throw new AppException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          ErrorCode.VALIDATION_ERROR,
          'Choose your own properties only.',
          { issues: [{ path: 'propertyIds', message: 'Choose your own properties only' }] },
        );
      }
    }
    const row = await this.insert(actor, input.code, meta, {
      scope: DiscountScope.BOOKING,
      ownerKey: agentProfileId,
      ownerAgentProfileId: agentProfileId,
      propertyIds,
      description: input.description ?? null,
      percentOff: input.percentOff ?? null,
      amountOffKobo: input.amountOffKobo == null ? null : BigInt(input.amountOffKobo),
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      maxRedemptions: input.maxRedemptions ?? null,
      perUserLimit: input.perUserLimit ?? 1,
    });
    return this.get(row.id, { kind: 'AGENT', agentProfileId });
  }

  async create(
    actor: AuthContext,
    input: z.output<typeof createDiscountCodeSchema>,
    meta: RequestMeta,
  ): Promise<AdminDiscountCodeDetail> {
    const planIds = await this.checkPlans(input.planIds ?? []);
    const agentProfileIds = await this.resolveAgents(input.agentEmails ?? []);
    const row = await this.insert(actor, input.code, meta, {
      scope: DiscountScope.SUBSCRIPTION,
      description: input.description ?? null,
      percentOff: input.percentOff ?? null,
      amountOffKobo: input.amountOffKobo == null ? null : BigInt(input.amountOffKobo),
      planIds,
      agentProfileIds,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      maxRedemptions: input.maxRedemptions ?? null,
      perUserLimit: input.perUserLimit ?? 1,
    });
    return this.get(row.id);
  }

  private async insert(
    actor: AuthContext,
    code: string,
    meta: RequestMeta,
    data: Omit<Prisma.DiscountCodeUncheckedCreateInput, 'code' | 'createdById'>,
  ): Promise<DiscountCode> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.discountCode.create({
          data: { ...data, code, createdById: actor.user.id },
        });
        await this.audit.record(
          {
            actorId: actor.user.id,
            action: 'discount_code.created',
            resourceType: 'discount_code',
            resourceId: created.id,
            after: snapshot(created),
            meta,
          },
          tx,
        );
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw Errors.conflict(`You already have a code called ${code}.`);
      }
      throw error;
    }
  }

  async update(
    actor: AuthContext,
    id: string,
    input: z.output<typeof updateDiscountCodeSchema> | z.output<typeof updatePromoCodeSchema>,
    meta: RequestMeta,
    viewer: CodeViewer = { kind: 'ADMIN' },
  ): Promise<AdminDiscountCodeDetail> {
    const emails = 'agentEmails' in input ? input.agentEmails : undefined;
    const agentProfileIds = emails === undefined ? undefined : await this.resolveAgents(emails);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM discount_codes WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.discountCode.findFirst({ where: { id, ...ownedBy(viewer) } });
      if (!current) throw Errors.notFound('Discount code');
      const endsAt = input.endsAt === undefined ? current.endsAt : input.endsAt;
      if (endsAt && current.startsAt && endsAt <= current.startsAt) {
        throw new AppException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          ErrorCode.VALIDATION_ERROR,
          'The end must be after the start.',
          { issues: [{ path: 'endsAt', message: 'The end must be after the start' }] },
        );
      }
      const updated = await tx.discountCode.update({
        where: { id },
        data: {
          ...(input.active !== undefined ? { active: input.active } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
          ...(input.maxRedemptions !== undefined ? { maxRedemptions: input.maxRedemptions } : {}),
          ...(agentProfileIds !== undefined ? { agentProfileIds } : {}),
        },
      });
      await this.audit.record(
        {
          actorId: actor.user.id,
          action: 'discount_code.updated',
          resourceType: 'discount_code',
          resourceId: id,
          before: snapshot(current),
          after: snapshot(updated),
          meta,
        },
        tx,
      );
    });
    return this.get(id, viewer);
  }

  /**
   * Puts the code in the inbox of every agent who may use it: the listed
   * agents, or every active agent when it is open to all.
   */
  async send(actor: AuthContext, id: string, meta: RequestMeta): Promise<{ recipients: number }> {
    const code = await this.prisma.discountCode.findFirst({
      where: { id, ...ownedBy({ kind: 'ADMIN' }) },
    });
    if (!code) throw Errors.notFound('Discount code');
    const now = new Date();
    if (!code.active || (code.endsAt && code.endsAt <= now)) {
      throw Errors.conflict('Only an active, unexpired code can be sent.');
    }
    const users = await this.prisma.user.findMany({
      where: {
        accountType: AccountType.AGENT,
        status: UserStatus.ACTIVE,
        ...(code.agentProfileIds.length > 0
          ? { agentProfile: { id: { in: code.agentProfileIds } } }
          : { agentProfile: { isNot: null } }),
      },
      select: { id: true },
    });
    const [view] = await this.views([code]);
    const plans = view!.plans.length ? view!.plans.map((p) => p.name).join(', ') : 'any paid plan';
    const until = code.endsAt
      ? ` until ${code.endsAt.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' })}`
      : '';
    const message = {
      type: NotificationType.ANNOUNCEMENT,
      title: `Discount: ${view!.label} your plan`,
      body: `Use code ${code.code} for ${view!.label} ${plans}${until}. Enter it at checkout, or open this notification to apply it.`,
      link: `/agent/subscription/plans?code=${encodeURIComponent(code.code)}`,
    };
    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < users.length; i += 1000) {
        await this.notifications.notify(
          tx,
          users.slice(i, i + 1000).map((u) => ({ userId: u.id, ...message })),
        );
      }
      await this.audit.record(
        {
          actorId: actor.user.id,
          action: 'discount_code.sent',
          resourceType: 'discount_code',
          resourceId: id,
          after: { code: code.code, recipients: users.length },
          meta,
        },
        tx,
      );
    });
    return { recipients: users.length };
  }

  private async checkPlans(planIds: string[]): Promise<string[]> {
    const unique = [...new Set(planIds)];
    if (unique.length === 0) return [];
    const plans = await this.prisma.subscriptionPlan.findMany({
      where: { id: { in: unique }, isDefault: false },
      select: { id: true },
    });
    if (plans.length !== unique.length) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.VALIDATION_ERROR,
        'Choose paid plans only.',
        { issues: [{ path: 'planIds', message: 'Choose paid plans only' }] },
      );
    }
    return unique;
  }

  private async resolveAgents(emails: string[]): Promise<string[]> {
    const unique = [...new Set(emails.map((e) => e.toLowerCase()))];
    if (unique.length === 0) return [];
    const profiles = await this.prisma.agentProfile.findMany({
      where: { user: { email: { in: unique, mode: 'insensitive' } } },
      select: { id: true, user: { select: { email: true } } },
    });
    const found = new Set(profiles.map((p) => p.user.email.toLowerCase()));
    const missing = unique.filter((e) => !found.has(e));
    if (missing.length > 0) {
      const message = `No agent account for: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`;
      throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.VALIDATION_ERROR, message, {
        issues: [{ path: 'agentEmails', message }],
      });
    }
    return profiles.map((p) => p.id);
  }

  private async views(rows: DiscountCode[]): Promise<AdminDiscountCodeView[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const now = new Date();
    const [plans, agents, properties, redeemed, pending, creators] = await Promise.all([
      this.prisma.subscriptionPlan.findMany({
        where: { id: { in: [...new Set(rows.flatMap((r) => r.planIds))] } },
        select: { id: true, name: true },
      }),
      this.prisma.agentProfile.findMany({
        where: { id: { in: [...new Set(rows.flatMap((r) => r.agentProfileIds))] } },
        select: AGENT_SELECT,
      }),
      this.prisma.property.findMany({
        where: { id: { in: [...new Set(rows.flatMap((r) => r.propertyIds))] } },
        select: { id: true, title: true },
      }),
      this.prisma.discountRedemption.groupBy({
        by: ['discountCodeId'],
        where: { discountCodeId: { in: ids }, status: 'REDEEMED' },
        _count: { _all: true },
        _sum: { amountOffKobo: true },
      }),
      this.prisma.discountRedemption.groupBy({
        by: ['discountCodeId'],
        where: {
          discountCodeId: { in: ids },
          AND: [{ status: 'PENDING' }, countedUses(now)],
        },
        _count: { _all: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: rows.flatMap((r) => (r.createdById ? [r.createdById] : [])) } },
        select: { id: true, fullName: true },
      }),
    ]);
    return rows.map((r) => {
      const paid = redeemed.find((g) => g.discountCodeId === r.id);
      const amountOffKobo = r.amountOffKobo === null ? null : koboToNumber(r.amountOffKobo);
      return {
        id: r.id,
        code: r.code,
        scope: r.scope as DiscountScope,
        description: r.description,
        percentOff: r.percentOff,
        amountOffKobo,
        label: discountLabel({ percentOff: r.percentOff, amountOffKobo }),
        plans: plans.filter((p) => r.planIds.includes(p.id)),
        agents: agents.filter((a) => r.agentProfileIds.includes(a.id)).map(agentRef),
        properties: properties.filter((p) => r.propertyIds.includes(p.id)),
        startsAt: r.startsAt?.toISOString() ?? null,
        endsAt: r.endsAt?.toISOString() ?? null,
        maxRedemptions: r.maxRedemptions,
        perUserLimit: r.perUserLimit,
        active: r.active,
        redeemed: paid?._count._all ?? 0,
        pending: pending.find((g) => g.discountCodeId === r.id)?._count._all ?? 0,
        discountGivenKobo: paid?._sum.amountOffKobo ? koboToNumber(paid._sum.amountOffKobo) : 0,
        createdBy: creators.find((u) => u.id === r.createdById) ?? null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }
}

type AgentRow = {
  id: string;
  businessName: string | null;
  user: { id: string; fullName: string; email: string };
};

const agentRef = (a: AgentRow) => ({
  agentProfileId: a.id,
  name: agentDisplayName(a),
  email: a.user.email,
});

/** Plan codes for administrators; an agent's own promo codes for that agent. */
const ownedBy = (viewer: CodeViewer): Prisma.DiscountCodeWhereInput =>
  viewer.kind === 'ADMIN'
    ? { scope: DiscountScope.SUBSCRIPTION }
    : { scope: DiscountScope.BOOKING, ownerAgentProfileId: viewer.agentProfileId };

const snapshot = (r: DiscountCode) => ({
  code: r.code,
  scope: r.scope,
  ownerAgentProfileId: r.ownerAgentProfileId,
  propertyIds: r.propertyIds,
  percentOff: r.percentOff,
  amountOffKobo: r.amountOffKobo?.toString() ?? null,
  planIds: r.planIds,
  agentProfileIds: r.agentProfileIds,
  startsAt: r.startsAt?.toISOString() ?? null,
  endsAt: r.endsAt?.toISOString() ?? null,
  maxRedemptions: r.maxRedemptions,
  perUserLimit: r.perUserLimit,
  active: r.active,
  description: r.description,
});

import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AgentVerificationStatus,
  ErrorCode,
  type adminListAgentsQuerySchema,
  type AdminAgentDetail,
  type AdminAgentListItem,
  type AdminUpdateAgentVerificationInput,
  type AgentOnboardingView,
  type AgentPlanUsageView,
  type AgentProfileView,
  type AgentPublicView,
  type SubmitAgentIdentityInput,
  type UpdateAgentProfileInput,
  type UpsertPayoutAccountInput,
} from '@havenhub/shared';

import type { z } from 'zod';

import { AppException, Errors } from '../../common/errors/app.exception';
import { paginate } from '../../common/http/response';
import type { RequestMeta } from '../../common/http/request-meta';
import { Prisma, type AgentProfile, type PayoutAccount } from '../../generated/prisma/client';
import { FieldEncryptionService } from '../../infrastructure/crypto/field-encryption.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { COUNTED_STATUSES, PlanLimitsService } from '../plans/plan-limits.service';
import { toAgentProfileView, toAgentPublicView } from './agent.mapper';
import {
  AGENT_SUBMITTABLE,
  canAdminTransition,
  permissionForTransition,
} from './agent-verification';

type ProfileWithPayout = AgentProfile & { payoutAccount: PayoutAccount | null };

@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldEncryptionService,
    private readonly audit: AuditService,
    private readonly plans: PlanLimitsService,
    private readonly storage: StorageService,
  ) {}

  // ── Agent self-service (always scoped to the caller's own profile) ──────

  async getOwn(userId: string): Promise<AgentProfileView> {
    return toAgentProfileView(await this.findOwn(userId));
  }

  async updateOwn(userId: string, input: UpdateAgentProfileInput): Promise<AgentProfileView> {
    const profile = await this.findOwn(userId);
    const updated = await this.prisma.agentProfile.update({
      where: { id: profile.id },
      data: input,
      include: { payoutAccount: true },
    });
    return toAgentProfileView(updated);
  }

  /** Stores the NIN encrypted. Locked while under review or once verified. */
  async submitIdentity(
    userId: string,
    input: SubmitAgentIdentityInput,
    meta: RequestMeta,
  ): Promise<AgentProfileView> {
    const profile = await this.findOwn(userId);
    if (!AGENT_SUBMITTABLE.includes(profile.verificationStatus)) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATUS_TRANSITION,
        'Your identity details cannot be changed while under review or after verification. Please contact support.',
      );
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const result = await tx.agentProfile.update({
          where: { id: profile.id },
          data: {
            ninCiphertext: this.crypto.encrypt(input.nin),
            ninFingerprint: this.crypto.fingerprint(input.nin),
            ninLast4: input.nin.slice(-4),
            idDocumentType: input.idDocumentType,
          },
          include: { payoutAccount: true },
        });
        await this.audit.record(
          {
            actorId: userId,
            action: 'agent.identity.submitted',
            resourceType: 'agent_profile',
            resourceId: profile.id,
            after: { idDocumentType: input.idDocumentType },
            meta,
          },
          tx,
        );
        return result;
      });
      return toAgentProfileView(updated);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw Errors.conflict('This NIN is already linked to another HavenHub account.');
      }
      throw error;
    }
  }

  async upsertPayoutAccount(
    userId: string,
    input: UpsertPayoutAccountInput,
    meta: RequestMeta,
  ): Promise<AgentProfileView> {
    const profile = await this.findOwn(userId);
    const data = {
      bankName: input.bankName,
      bankCode: input.bankCode,
      accountName: input.accountName,
      accountNumberCiphertext: this.crypto.encrypt(input.accountNumber),
      accountNumberLast4: input.accountNumber.slice(-4),
      // Any change must be re-verified with the payment provider (Phase 3).
      verifiedAt: null,
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.payoutAccount.upsert({
        where: { agentProfileId: profile.id },
        create: { agentProfileId: profile.id, ...data },
        update: data,
      });
      // Payout changes are a common fraud vector: always audit them.
      await this.audit.record(
        {
          actorId: userId,
          action: 'agent.payout_account.updated',
          resourceType: 'agent_profile',
          resourceId: profile.id,
          before: profile.payoutAccount
            ? {
                bankCode: profile.payoutAccount.bankCode,
                last4: profile.payoutAccount.accountNumberLast4,
              }
            : undefined,
          after: { bankCode: input.bankCode, last4: data.accountNumberLast4 },
          meta,
        },
        tx,
      );
    });
    return this.getOwn(userId);
  }

  async submitForVerification(userId: string, meta: RequestMeta): Promise<AgentProfileView> {
    const profile = await this.findOwn(userId);
    if (!AGENT_SUBMITTABLE.includes(profile.verificationStatus)) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATUS_TRANSITION,
        'Your verification has already been submitted.',
      );
    }
    const missing = missingForVerification(profile);
    if (missing.length) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.AGENT_PROFILE_INCOMPLETE,
        'Please complete your profile and identity details first.',
        { missing },
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.agentProfile.update({
        where: { id: profile.id },
        data: {
          verificationStatus: AgentVerificationStatus.UNDER_REVIEW,
          verificationSubmittedAt: new Date(),
          verificationNote: null,
        },
        include: { payoutAccount: true },
      });
      await this.audit.record(
        {
          actorId: userId,
          action: 'agent.verification.submitted',
          resourceType: 'agent_profile',
          resourceId: profile.id,
          before: { status: profile.verificationStatus },
          after: { status: AgentVerificationStatus.UNDER_REVIEW },
          meta,
        },
        tx,
      );
      return result;
    });
    return toAgentProfileView(updated);
  }

  async onboarding(userId: string): Promise<AgentOnboardingView> {
    const profile = await this.findOwn(userId);
    const submitted = !AGENT_SUBMITTABLE.includes(profile.verificationStatus);
    const steps: AgentOnboardingView['steps'] = [
      {
        key: 'profile',
        title: 'Complete your profile',
        description: 'Tell customers who you are and where you operate.',
        completed: missingProfileFields(profile).length === 0,
        available: true,
      },
      {
        key: 'identity',
        title: 'Verify your identity',
        description: 'Submit your NIN so our team can verify your account.',
        completed: submitted,
        available: true,
      },
      {
        key: 'property',
        title: 'Add your first property',
        description: 'List a home, shop, land or stay.',
        completed: false,
        available: false,
      },
      {
        key: 'payout',
        title: 'Configure your payout account',
        description: 'Where we send your earnings.',
        completed: profile.payoutAccount !== null,
        available: true,
      },
      {
        key: 'plan',
        title: 'Choose your subscription plan',
        description: 'Start free, upgrade when you need more listings.',
        completed: false,
        available: false,
      },
      {
        key: 'customers',
        title: 'Start receiving customers',
        description: 'Bookings and enquiries will appear here.',
        completed: false,
        available: false,
      },
    ];
    return {
      steps,
      completedCount: steps.filter((s) => s.completed).length,
      dismissed: profile.onboardingDismissedAt !== null,
    };
  }

  async setOnboardingDismissed(userId: string, dismissed: boolean): Promise<AgentOnboardingView> {
    const profile = await this.findOwn(userId);
    await this.prisma.agentProfile.update({
      where: { id: profile.id },
      data: { onboardingDismissedAt: dismissed ? new Date() : null },
    });
    return this.onboarding(userId);
  }

  /**
   * Compact plan summary (kept for existing clients; the full view is
   * `GET /agents/me/subscription`). Limits come from the plan in force.
   */
  async planUsage(userId: string): Promise<AgentPlanUsageView> {
    const profile = await this.findOwn(userId);
    const { plan, limits } = await this.plans.effectivePlan(profile.id);
    const properties = await this.prisma.property.count({
      where: { agentProfileId: profile.id, status: { in: COUNTED_STATUSES } },
    });
    return {
      planName: plan.name,
      isDefaultPlan: plan.isDefault,
      usage: [
        {
          key: 'properties',
          label: 'Active properties',
          used: properties,
          limit: limits.PROPERTY_COUNT,
        },
        {
          key: 'images',
          label: 'Images per property',
          used: null,
          limit: limits.IMAGES_PER_PROPERTY,
        },
        {
          key: 'videos',
          label: 'Videos per property',
          used: null,
          limit: limits.VIDEOS_PER_PROPERTY,
        },
      ],
    };
  }

  // ── Public ───────────────────────────────────────────────────────────────

  /** Only verified agents with active accounts have a public profile. */
  async getPublic(id: string): Promise<AgentPublicView> {
    const profile = await this.prisma.agentProfile.findFirst({
      where: {
        id,
        verificationStatus: AgentVerificationStatus.VERIFIED,
        user: { status: 'ACTIVE' },
      },
      include: { user: { select: { fullName: true, avatarKey: true, createdAt: true } } },
    });
    if (!profile) throw Errors.notFound('Agent');
    const published = await this.prisma.property.count({
      where: { agentProfileId: profile.id, status: 'PUBLISHED' },
    });
    return toAgentPublicView(profile, this.storage.url(profile.user.avatarKey), published);
  }

  // ── Administration ───────────────────────────────────────────────────────

  async adminList(query: z.output<typeof adminListAgentsQuerySchema>) {
    const where: Prisma.AgentProfileWhereInput = {
      ...(query.verificationStatus ? { verificationStatus: query.verificationStatus } : {}),
      ...(query.search
        ? {
            OR: [
              { businessName: { contains: query.search, mode: 'insensitive' } },
              { user: { fullName: { contains: query.search, mode: 'insensitive' } } },
              { user: { email: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.agentProfile.count({ where }),
      this.prisma.agentProfile.findMany({
        where,
        orderBy: [
          { verificationSubmittedAt: { sort: 'asc', nulls: 'last' } },
          { createdAt: 'desc' },
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { user: true },
      }),
    ]);
    const items: AdminAgentListItem[] = rows.map((row) => toAdminAgentListItem(row));
    return paginate(items, query.page, query.pageSize, total);
  }

  async adminGet(id: string): Promise<AdminAgentDetail> {
    const profile = await this.prisma.agentProfile.findUnique({
      where: { id },
      include: { user: true, payoutAccount: true },
    });
    if (!profile) throw Errors.notFound('Agent');
    return {
      ...toAdminAgentListItem(profile),
      profile: toAgentProfileView(profile),
      userStatus: profile.user.status,
      emailVerified: profile.user.emailVerifiedAt !== null,
    };
  }

  async adminUpdateVerification(
    actor: AuthContext,
    id: string,
    input: AdminUpdateAgentVerificationInput,
    meta: RequestMeta,
  ): Promise<AdminAgentDetail> {
    if (!actor.permissions.has(permissionForTransition(input.status))) {
      throw Errors.insufficientPermissions();
    }
    const profile = await this.prisma.agentProfile.findUnique({ where: { id } });
    if (!profile) throw Errors.notFound('Agent');
    if (profile.userId === actor.user.id)
      throw Errors.forbidden('You cannot review your own account.');

    if (!canAdminTransition(profile.verificationStatus, input.status)) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATUS_TRANSITION,
        `An agent cannot move from ${profile.verificationStatus} to ${input.status}.`,
      );
    }
    if (
      input.status === AgentVerificationStatus.VERIFIED &&
      missingForVerification(profile).length
    ) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.AGENT_PROFILE_INCOMPLETE,
        'This agent has not provided the details required for verification.',
      );
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.agentProfile.update({
        where: { id },
        data: {
          verificationStatus: input.status,
          verificationNote: input.note ?? null,
          verificationReviewedAt: now,
          verificationReviewerId: actor.user.id,
          ...(input.status === AgentVerificationStatus.VERIFIED ? { verifiedAt: now } : {}),
        },
      });
      await this.audit.record(
        {
          actorId: actor.user.id,
          action: 'agent.verification.updated',
          resourceType: 'agent_profile',
          resourceId: id,
          before: { status: profile.verificationStatus },
          after: { status: input.status, note: input.note ?? null },
          meta,
        },
        tx,
      );
    });
    return this.adminGet(id);
  }

  private async findOwn(userId: string): Promise<ProfileWithPayout> {
    const profile = await this.prisma.agentProfile.findUnique({
      where: { userId },
      include: { payoutAccount: true },
    });
    if (!profile) throw Errors.notFound('Agent profile');
    return profile;
  }
}

function missingProfileFields(profile: AgentProfile): string[] {
  const required: (keyof AgentProfile)[] = ['addressLine', 'city', 'lga', 'state'];
  return required.filter((field) => !profile[field]);
}

function missingForVerification(profile: AgentProfile): string[] {
  const missing = missingProfileFields(profile);
  if (!profile.ninCiphertext || !profile.idDocumentType) missing.push('identity');
  return missing;
}

function toAdminAgentListItem(
  row: AgentProfile & {
    user: { id: string; fullName: string; email: string; phone: string | null };
  },
): AdminAgentListItem {
  return {
    id: row.id,
    userId: row.user.id,
    fullName: row.user.fullName,
    email: row.user.email,
    phone: row.user.phone,
    businessName: row.businessName,
    serviceTypes: row.serviceTypes,
    state: row.state,
    verificationStatus: row.verificationStatus,
    verificationSubmittedAt: row.verificationSubmittedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

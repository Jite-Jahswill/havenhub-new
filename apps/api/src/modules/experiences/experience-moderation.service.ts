import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AgentVerificationStatus,
  ErrorCode,
  ExperienceStatus,
  UserStatus,
  type AdminExperienceDetail,
  type AdminExperienceListItem,
  type AdminModerateExperienceInput,
  type Paginated,
  type adminListExperiencesQuerySchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { AppException, Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { paginate } from '../../common/http/response';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { toAmenityView } from '../properties/property.mapper';
import { agentDisplayName } from '../properties/property.selects';
import { MODERATION, moderationTarget } from './experience-lifecycle';
import { toAgentExperienceView } from './experience.mapper';
import { AGENT_EXPERIENCE_INCLUDE } from './experience.selects';

/** Admin review of events, tours, hotels and cleaning services — the property flow, reused. */
@Injectable()
export class ExperienceModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async list(
    query: z.output<typeof adminListExperiencesQuerySchema>,
  ): Promise<Paginated<AdminExperienceListItem>> {
    const where: Prisma.ExperienceWhereInput = {
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { city: { contains: query.search, mode: 'insensitive' } },
              { slug: { contains: query.search.toLowerCase() } },
              { agentProfile: { businessName: { contains: query.search, mode: 'insensitive' } } },
              {
                agentProfile: { user: { email: { contains: query.search, mode: 'insensitive' } } },
              },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.ExperienceOrderByWithRelationInput[] =
      query.status === ExperienceStatus.PENDING_REVIEW
        ? [{ submittedAt: 'asc' }, { id: 'asc' }]
        : [{ updatedAt: 'desc' }, { id: 'asc' }];

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.experience.count({ where }),
      this.prisma.experience.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          slug: true,
          kind: true,
          title: true,
          status: true,
          city: true,
          state: true,
          submittedAt: true,
          updatedAt: true,
          images: { where: { isPrimary: true }, take: 1, select: { thumbnailKey: true } },
          agentProfile: {
            select: {
              id: true,
              businessName: true,
              user: { select: { fullName: true, email: true } },
            },
          },
        },
      }),
    ]);
    return paginate(
      rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        kind: row.kind,
        title: row.title,
        status: row.status,
        city: row.city,
        state: row.state,
        agent: {
          id: row.agentProfile.id,
          displayName: agentDisplayName(row.agentProfile),
          email: row.agentProfile.user.email,
        },
        coverImage: row.images[0]
          ? { thumbnailUrl: this.storage.url(row.images[0].thumbnailKey) }
          : null,
        submittedAt: row.submittedAt?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString(),
      })),
      query.page,
      query.pageSize,
      total,
    );
  }

  async get(id: string): Promise<AdminExperienceDetail> {
    const row = await this.prisma.experience.findUnique({
      where: { id },
      include: {
        ...AGENT_EXPERIENCE_INCLUDE,
        amenities: { include: { amenity: true } },
        agentProfile: { include: { user: { select: { id: true, fullName: true, email: true } } } },
      },
    });
    if (!row) throw Errors.notFound('Listing');
    const view = toAgentExperienceView(
      { ...row, amenities: row.amenities.map((a) => ({ amenityId: a.amenityId })) },
      this.storage,
    );
    return {
      ...view,
      agent: {
        id: row.agentProfile.id,
        userId: row.agentProfile.user.id,
        displayName: agentDisplayName(row.agentProfile),
        email: row.agentProfile.user.email,
        verificationStatus: row.agentProfile.verificationStatus,
      },
      amenities: row.amenities.map((a) => toAmenityView(a.amenity)),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
    };
  }

  async moderate(
    actor: AuthContext,
    id: string,
    input: AdminModerateExperienceInput,
    meta: RequestMeta,
  ): Promise<AdminExperienceDetail> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM experiences WHERE id = ${id}::uuid FOR UPDATE`;
      const listing = await tx.experience.findUnique({
        where: { id },
        include: { agentProfile: { include: { user: { select: { id: true, status: true } } } } },
      });
      if (!listing) throw Errors.notFound('Listing');
      if (listing.agentProfile.user.id === actor.user.id) {
        throw Errors.forbidden('You cannot moderate your own listing.');
      }
      if (!MODERATION[input.action].from.includes(listing.status)) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATUS_TRANSITION,
          `A ${listing.status.toLowerCase().replace('_', ' ')} listing cannot be ${actionPast(input.action)}.`,
        );
      }
      const target = moderationTarget(input.action, listing);
      if (target === ExperienceStatus.PUBLISHED) {
        const agentOk =
          listing.agentProfile.verificationStatus === AgentVerificationStatus.VERIFIED &&
          listing.agentProfile.user.status === UserStatus.ACTIVE;
        if (!agentOk) {
          throw new AppException(
            HttpStatus.CONFLICT,
            ErrorCode.AGENT_NOT_VERIFIED,
            'The agent must be verified and active before this listing can be published.',
          );
        }
      }

      const now = new Date();
      await tx.experience.update({
        where: { id },
        data: {
          status: target,
          moderationNote: input.note ?? null,
          reviewedAt: now,
          reviewerId: actor.user.id,
          ...(target === ExperienceStatus.PUBLISHED && !listing.publishedAt
            ? { publishedAt: now }
            : {}),
        },
      });
      await this.audit.record(
        {
          actorId: actor.user.id,
          action: `experience.moderation.${input.action.toLowerCase()}`,
          resourceType: 'experience',
          resourceId: id,
          before: { status: listing.status },
          after: { status: target, note: input.note ?? null, kind: listing.kind },
          meta,
        },
        tx,
      );
    });
    return this.get(id);
  }
}

const actionPast = (action: string) =>
  ({ APPROVE: 'approved', REJECT: 'rejected', SUSPEND: 'suspended', RESTORE: 'restored' })[
    action
  ] ?? action;

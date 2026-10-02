import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AgentVerificationStatus,
  ErrorCode,
  PropertyStatus,
  UserStatus,
  type AdminModeratePropertyInput,
  type AdminPropertyDetail,
  type AdminPropertyListItem,
  type Paginated,
  type adminListPropertiesQuerySchema,
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
import { AgentPropertiesService } from './agent-properties.service';
import { MODERATION, moderationTarget } from './property-lifecycle';
import { num, toAmenityView } from './property.mapper';
import { AGENT_PROPERTY_INCLUDE, agentDisplayName } from './property.selects';

@Injectable()
export class PropertyModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly agentProperties: AgentPropertiesService,
  ) {}

  /** The moderation queue (oldest submissions first) or any filtered list. */
  async list(
    query: z.output<typeof adminListPropertiesQuerySchema>,
  ): Promise<Paginated<AdminPropertyListItem>> {
    const where: Prisma.PropertyWhereInput = {
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
    const orderBy: Prisma.PropertyOrderByWithRelationInput[] =
      query.status === PropertyStatus.PENDING_REVIEW
        ? [{ submittedAt: 'asc' }]
        : [{ updatedAt: 'desc' }];

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.property.count({ where }),
      this.prisma.property.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          slug: true,
          title: true,
          status: true,
          propertyType: true,
          listingType: true,
          pricingPeriod: true,
          priceKobo: true,
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
        title: row.title,
        status: row.status,
        propertyType: row.propertyType,
        listingType: row.listingType,
        pricingPeriod: row.pricingPeriod,
        priceKobo: num(row.priceKobo),
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

  async get(id: string): Promise<AdminPropertyDetail> {
    const row = await this.prisma.property.findUnique({
      where: { id },
      include: {
        ...AGENT_PROPERTY_INCLUDE,
        amenities: { include: { amenity: true } },
        agentProfile: { include: { user: { select: { id: true, fullName: true, email: true } } } },
      },
    });
    if (!row) throw Errors.notFound('Property');
    const view = await this.agentProperties.view({
      ...row,
      amenities: row.amenities.map((a) => ({ amenityId: a.amenityId })),
    });
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
    input: AdminModeratePropertyInput,
    meta: RequestMeta,
  ): Promise<AdminPropertyDetail> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM properties WHERE id = ${id}::uuid FOR UPDATE`;
      const property = await tx.property.findUnique({
        where: { id },
        include: { agentProfile: { include: { user: { select: { id: true, status: true } } } } },
      });
      if (!property) throw Errors.notFound('Property');
      if (property.agentProfile.user.id === actor.user.id) {
        throw Errors.forbidden('You cannot moderate your own listing.');
      }
      if (!MODERATION[input.action].from.includes(property.status)) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATUS_TRANSITION,
          `A ${property.status.toLowerCase().replace('_', ' ')} property cannot be ${actionPast(input.action)}.`,
        );
      }
      const target = moderationTarget(input.action, property);
      if (target === PropertyStatus.PUBLISHED) {
        const agentOk =
          property.agentProfile.verificationStatus === AgentVerificationStatus.VERIFIED &&
          property.agentProfile.user.status === UserStatus.ACTIVE;
        if (!agentOk) {
          throw new AppException(
            HttpStatus.CONFLICT,
            ErrorCode.AGENT_NOT_VERIFIED,
            'The agent must be verified and active before this property can be published.',
          );
        }
      }

      const now = new Date();
      await tx.property.update({
        where: { id },
        data: {
          status: target,
          moderationNote: input.note ?? null,
          reviewedAt: now,
          reviewerId: actor.user.id,
          ...(target === PropertyStatus.PUBLISHED && !property.publishedAt
            ? { publishedAt: now }
            : {}),
        },
      });
      await this.audit.record(
        {
          actorId: actor.user.id,
          action: `property.moderation.${input.action.toLowerCase()}`,
          resourceType: 'property',
          resourceId: id,
          before: { status: property.status },
          after: { status: target, note: input.note ?? null },
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

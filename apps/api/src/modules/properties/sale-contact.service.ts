import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode, type SaleContactView, type acceptSaleContactSchema } from '@havenhub/shared';
import { createHash } from 'node:crypto';
import type { z } from 'zod';

import { AppException, Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PlatformPoliciesService } from '../platform/platform-policies.service';
import { PUBLIC_PROPERTY_WHERE, agentDisplayName } from './property.selects';

/** Identifies one version of the notice (the buyer must accept the current one). */
export const disclaimerHash = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * Contact for sale: a signed-in buyer accepts the administrators' notice that
 * deals made outside HavenHub are not HavenHub's responsibility; the exact
 * wording, time, IP address and browser are kept (append-only), then the
 * agent's direct contact details are returned.
 */
@Injectable()
export class SaleContactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policies: PlatformPoliciesService,
  ) {}

  async reveal(
    userId: string,
    slug: string,
    input: z.output<typeof acceptSaleContactSchema>,
    meta: RequestMeta,
  ): Promise<SaleContactView> {
    const property = await this.prisma.property.findFirst({
      where: { ...PUBLIC_PROPERTY_WHERE, slug },
      select: {
        id: true,
        listingType: true,
        saleMode: true,
        agentProfile: {
          select: {
            userId: true,
            businessName: true,
            user: { select: { fullName: true, email: true, phone: true } },
          },
        },
      },
    });
    if (!property) throw Errors.notFound('Property');
    const { sales } = await this.policies.get();
    if (property.listingType !== 'SALE' || property.saleMode !== 'CONTACT') {
      throw Errors.notFound('Contact details');
    }
    if (!sales.contactEnabled || !sales.disclaimer) {
      throw Errors.featureDisabled(
        'Direct contact is not available. Message the agent through HavenHub instead.',
      );
    }
    if (input.disclaimerHash !== disclaimerHash(sales.disclaimer)) {
      // The notice changed since the page loaded: the buyer must read the new one.
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        'The notice has been updated. Please read it again before continuing.',
      );
    }
    if (property.agentProfile.userId === userId) throw Errors.notFound('Contact details');

    await this.prisma.$transaction(async (tx) => {
      const accepted = await tx.saleContactAcceptance.create({
        data: {
          propertyId: property.id,
          userId,
          disclaimerText: sales.disclaimer!,
          disclaimerHash: input.disclaimerHash,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
      });
      await this.audit.record(
        {
          actorId: userId,
          action: 'property.sale_contact.accepted',
          resourceType: 'property',
          resourceId: property.id,
          after: { acceptanceId: accepted.id, disclaimerHash: input.disclaimerHash },
          meta,
        },
        tx,
      );
    });

    const agent = property.agentProfile;
    return {
      agentName: agentDisplayName(agent),
      phone: agent.user.phone,
      email: agent.user.email,
    };
  }
}

import { HttpStatus, Injectable } from '@nestjs/common';
import { AgentVerificationStatus, ErrorCode, PropertyStatus } from '@havenhub/shared';

import { AppException, Errors } from '../../common/errors/app.exception';
import type { AgentProfile, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AGENT_EDITABLE, RESTRICTED_AGENT_STATUSES } from './property-lifecycle';
import { AGENT_PROPERTY_INCLUDE, type AgentPropertyRow } from './property.selects';

/**
 * Ownership and permission checks for agent-side property operations.
 * Every lookup is scoped to the caller's own agent profile, so another
 * agent's property id simply does not exist for them (404, not 403).
 */
@Injectable()
export class PropertyAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async agentFor(userId: string): Promise<AgentProfile> {
    const agent = await this.prisma.agentProfile.findUnique({ where: { userId } });
    if (!agent) throw Errors.notFound('Agent profile');
    return agent;
  }

  /** Suspended or blocked agents may view their listings but not change them. */
  assertCanManage(agent: AgentProfile): void {
    if (RESTRICTED_AGENT_STATUSES.includes(agent.verificationStatus)) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.AGENT_RESTRICTED,
        'Your agent account is restricted. Please contact support.',
      );
    }
  }

  /** Only verified agents can send listings to moderation. */
  assertVerified(agent: AgentProfile): void {
    this.assertCanManage(agent);
    if (agent.verificationStatus !== AgentVerificationStatus.VERIFIED) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.AGENT_NOT_VERIFIED,
        'Your agent account must be verified before listings can be published.',
      );
    }
  }

  async owned(
    agentProfileId: string,
    propertyId: string,
    db: Pick<PrismaService, 'property'> | Prisma.TransactionClient = this.prisma,
  ): Promise<AgentPropertyRow> {
    const property = await db.property.findFirst({
      where: { id: propertyId, agentProfileId },
      include: AGENT_PROPERTY_INCLUDE,
    });
    if (!property) throw Errors.notFound('Property');
    return property;
  }

  assertEditable(status: PropertyStatus): void {
    if (!AGENT_EDITABLE.includes(status)) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.PROPERTY_LOCKED,
        status === PropertyStatus.PENDING_REVIEW
          ? 'This property is awaiting review. Withdraw it to make changes.'
          : 'This property cannot be changed in its current state.',
      );
    }
  }
}

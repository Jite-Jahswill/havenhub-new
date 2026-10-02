import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode, ExperienceStatus, type ExperienceKind } from '@havenhub/shared';

import { AppException, Errors } from '../../common/errors/app.exception';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AGENT_EDITABLE } from './experience-lifecycle';
import { AGENT_EXPERIENCE_INCLUDE, type AgentExperienceRow } from './experience.selects';

type Tx = Prisma.TransactionClient;

const A_KIND: Record<ExperienceKind, string> = {
  EVENT: 'an event',
  TOUR: 'a tour',
  HOTEL: 'a hotel',
  CLEANING: 'a cleaning service',
};

/**
 * Ownership checks for agent-side experience operations. Every lookup is
 * scoped to the caller's own agent profile, so another agent's listing id
 * simply does not exist for them (404, not 403). Agent-level checks
 * (restricted, verified) are PropertyAccessService's, reused unchanged.
 */
@Injectable()
export class ExperienceAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async owned(
    agentProfileId: string,
    experienceId: string,
    db: Tx | PrismaService = this.prisma,
  ): Promise<AgentExperienceRow> {
    const row = await db.experience.findFirst({
      where: { id: experienceId, agentProfileId },
      include: AGENT_EXPERIENCE_INCLUDE,
    });
    if (!row) throw Errors.notFound('Listing');
    return row;
  }

  /**
   * Lock order everywhere: agent, then listing (plan checks lock the agent),
   * so concurrent changes to one listing serialise without deadlocks.
   */
  async lock(tx: Tx, agentProfileId: string, experienceId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM agent_profiles WHERE id = ${agentProfileId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM experiences WHERE id = ${experienceId}::uuid AND agent_profile_id = ${agentProfileId}::uuid FOR UPDATE`;
  }

  /** Locks, loads and checks the listing can be changed. */
  async ownedEditable(tx: Tx, agentProfileId: string, experienceId: string) {
    await this.lock(tx, agentProfileId, experienceId);
    const current = await this.owned(agentProfileId, experienceId, tx);
    this.assertEditable(current.status);
    return current;
  }

  assertEditable(status: ExperienceStatus): void {
    if (!AGENT_EDITABLE.includes(status)) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.PROPERTY_LOCKED,
        status === ExperienceStatus.PENDING_REVIEW
          ? 'This listing is awaiting review. Withdraw it to make changes.'
          : 'This listing cannot be changed in its current state.',
      );
    }
  }

  assertKind(row: { kind: ExperienceKind }, kind: ExperienceKind): void {
    if (row.kind !== kind) {
      throw Errors.badRequest(`This listing is not ${A_KIND[kind]}.`);
    }
  }

  /** Changed public content on a live listing must be moderated again. */
  async backToReviewIfPublished(tx: Tx, current: { id: string; status: string }) {
    if (current.status !== ExperienceStatus.PUBLISHED) return false;
    await tx.experience.update({
      where: { id: current.id },
      data: {
        status: ExperienceStatus.PENDING_REVIEW,
        submittedAt: new Date(),
        moderationNote: null,
      },
    });
    return true;
  }
}

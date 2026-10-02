import {
  AgentVerificationStatus as S,
  type AgentVerificationStatus,
  type Permission,
} from '@havenhub/shared';

/** Administrator-driven verification transitions. */
const ADMIN_TRANSITIONS: Record<AgentVerificationStatus, AgentVerificationStatus[]> = {
  [S.PENDING]: [S.UNDER_REVIEW, S.SUSPENDED, S.BLOCKED],
  [S.UNDER_REVIEW]: [S.VERIFIED, S.REJECTED, S.SUSPENDED, S.BLOCKED],
  [S.VERIFIED]: [S.UNDER_REVIEW, S.SUSPENDED, S.BLOCKED],
  [S.REJECTED]: [S.UNDER_REVIEW, S.BLOCKED],
  [S.SUSPENDED]: [S.UNDER_REVIEW, S.VERIFIED, S.BLOCKED],
  [S.BLOCKED]: [S.UNDER_REVIEW],
};

/** Statuses from which the agent may (re)submit their identity for review. */
export const AGENT_SUBMITTABLE: AgentVerificationStatus[] = [S.PENDING, S.REJECTED];

export function canAdminTransition(
  from: AgentVerificationStatus,
  to: AgentVerificationStatus,
): boolean {
  return ADMIN_TRANSITIONS[from].includes(to);
}

/** Suspending/blocking is a different responsibility from verifying. */
export function permissionForTransition(to: AgentVerificationStatus): Permission {
  return to === S.SUSPENDED || to === S.BLOCKED ? 'agents.suspend' : 'agents.verify';
}

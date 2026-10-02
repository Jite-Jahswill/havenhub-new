import { AgentVerificationStatus as S } from '@havenhub/shared';
import { describe, expect, it } from 'vitest';

import { canAdminTransition, permissionForTransition } from './agent-verification';

describe('agent verification transitions', () => {
  it('allows the review workflow', () => {
    expect(canAdminTransition(S.UNDER_REVIEW, S.VERIFIED)).toBe(true);
    expect(canAdminTransition(S.UNDER_REVIEW, S.REJECTED)).toBe(true);
    expect(canAdminTransition(S.VERIFIED, S.SUSPENDED)).toBe(true);
    expect(canAdminTransition(S.SUSPENDED, S.VERIFIED)).toBe(true);
  });

  it('forbids skipping review', () => {
    expect(canAdminTransition(S.PENDING, S.VERIFIED)).toBe(false);
    expect(canAdminTransition(S.REJECTED, S.VERIFIED)).toBe(false);
    expect(canAdminTransition(S.BLOCKED, S.VERIFIED)).toBe(false);
  });

  it('requires the suspend permission to suspend or block', () => {
    expect(permissionForTransition(S.SUSPENDED)).toBe('agents.suspend');
    expect(permissionForTransition(S.BLOCKED)).toBe('agents.suspend');
    expect(permissionForTransition(S.VERIFIED)).toBe('agents.verify');
    expect(permissionForTransition(S.REJECTED)).toBe('agents.verify');
  });
});

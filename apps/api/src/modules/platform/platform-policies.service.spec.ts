import { POLICY_DEFAULTS } from '@havenhub/shared';
import { describe, expect, it, vi } from 'vitest';

import { parsePolicies } from './platform-policies.service';

describe('parsePolicies', () => {
  it('treats a missing or non-object document as all defaults', () => {
    expect(parsePolicies(undefined)).toEqual(POLICY_DEFAULTS);
    expect(parsePolicies(null)).toEqual(POLICY_DEFAULTS);
    expect(parsePolicies('nope')).toEqual(POLICY_DEFAULTS);
  });

  it('keeps valid areas and falls back to defaults only for an invalid area', () => {
    const onInvalid = vi.fn();
    const parsed = parsePolicies(
      { booking: { maxOpenHoldsPerCustomer: 99 }, chat: { editWindowMinutes: 0 } },
      onInvalid,
    );
    expect(parsed.booking).toEqual(POLICY_DEFAULTS.booking);
    expect(parsed.chat).toEqual({ ...POLICY_DEFAULTS.chat, editWindowMinutes: 0 });
    expect(onInvalid).toHaveBeenCalledExactlyOnceWith('booking');
  });
});

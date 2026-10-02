import * as shared from '@havenhub/shared';
import { describe, expect, it } from 'vitest';

import * as db from './generated/prisma/enums';

/** Shared (client-facing) enums must stay identical to the database enums. */
describe('enum parity between @havenhub/shared and Prisma', () => {
  it.each([
    ['AccountType', shared.AccountType, db.AccountType],
    ['UserStatus', shared.UserStatus, db.UserStatus],
    ['AgentVerificationStatus', shared.AgentVerificationStatus, db.AgentVerificationStatus],
    ['Sex', shared.Sex, db.Sex],
    ['AgentServiceType', shared.AgentServiceType, db.AgentServiceType],
    ['IdDocumentType', shared.IdDocumentType, db.IdDocumentType],
    ['BillingInterval', shared.BillingInterval, db.BillingInterval],
    ['SubscriptionPlanStatus', shared.SubscriptionPlanStatus, db.SubscriptionPlanStatus],
    ['AgentSubscriptionStatus', shared.AgentSubscriptionStatus, db.AgentSubscriptionStatus],
    ['SubscriptionChangeType', shared.SubscriptionChangeType, db.SubscriptionChangeType],
    ['EntitlementKey', shared.EntitlementKey, db.EntitlementKey],
  ])('%s', (_, sharedEnum, dbEnum) => {
    expect(Object.values(sharedEnum).sort()).toEqual(Object.values(dbEnum).sort());
  });
});

import type { AgentProfileView, AgentPublicView, PayoutAccountView } from '@havenhub/shared';

import type { AgentProfile, PayoutAccount, User } from '../../generated/prisma/client';
import { maskLast4 } from '../../infrastructure/crypto/field-encryption.service';

/**
 * The agent's own view (and the admin review view). Sensitive numbers are
 * only ever returned masked; ciphertext and fingerprints never leave the API.
 */
export function toAgentProfileView(
  profile: AgentProfile & { payoutAccount: PayoutAccount | null },
): AgentProfileView {
  return {
    id: profile.id,
    businessName: profile.businessName,
    bio: profile.bio,
    sex: profile.sex,
    serviceTypes: profile.serviceTypes,
    addressLine: profile.addressLine,
    city: profile.city,
    lga: profile.lga,
    state: profile.state,
    verificationStatus: profile.verificationStatus,
    verificationNote: profile.verificationNote,
    verificationSubmittedAt: profile.verificationSubmittedAt?.toISOString() ?? null,
    verifiedAt: profile.verifiedAt?.toISOString() ?? null,
    identity: {
      submitted: profile.ninCiphertext !== null,
      idDocumentType: profile.idDocumentType,
      ninMasked: maskLast4(profile.ninLast4, 11),
    },
    payoutAccount: profile.payoutAccount ? toPayoutAccountView(profile.payoutAccount) : null,
    onboardingDismissedAt: profile.onboardingDismissedAt?.toISOString() ?? null,
    createdAt: profile.createdAt.toISOString(),
  };
}

export function toPayoutAccountView(account: PayoutAccount): PayoutAccountView {
  return {
    bankName: account.bankName,
    bankCode: account.bankCode,
    accountName: account.accountName,
    accountNumberMasked: maskLast4(account.accountNumberLast4, 10)!,
  };
}

/** Safe for anyone, including signed-out visitors. No contact or identity data. */
export function toAgentPublicView(
  profile: AgentProfile & { user: Pick<User, 'fullName' | 'avatarKey' | 'createdAt'> },
  avatarUrl: string | null,
  publishedPropertyCount: number,
): AgentPublicView {
  return {
    id: profile.id,
    displayName: profile.businessName ?? profile.user.fullName,
    avatarUrl,
    serviceTypes: profile.serviceTypes,
    city: profile.city,
    state: profile.state,
    verified: profile.verificationStatus === 'VERIFIED',
    memberSince: profile.user.createdAt.toISOString(),
    publishedPropertyCount,
  };
}

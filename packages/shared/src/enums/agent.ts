export const AgentVerificationStatus = {
  PENDING: 'PENDING',
  UNDER_REVIEW: 'UNDER_REVIEW',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
  BLOCKED: 'BLOCKED',
} as const;
export type AgentVerificationStatus =
  (typeof AgentVerificationStatus)[keyof typeof AgentVerificationStatus];

export const Sex = {
  MALE: 'MALE',
  FEMALE: 'FEMALE',
} as const;
export type Sex = (typeof Sex)[keyof typeof Sex];

/** What an agent offers on HavenHub. An agent may offer several. */
export const AgentServiceType = {
  PROPERTY_OWNER: 'PROPERTY_OWNER',
  LANDLORD: 'LANDLORD',
  REAL_ESTATE_AGENT: 'REAL_ESTATE_AGENT',
  HOTEL_OPERATOR: 'HOTEL_OPERATOR',
  EVENT_ORGANIZER: 'EVENT_ORGANIZER',
  TOUR_OPERATOR: 'TOUR_OPERATOR',
  CLEANER: 'CLEANER',
} as const;
export type AgentServiceType = (typeof AgentServiceType)[keyof typeof AgentServiceType];

export const IdDocumentType = {
  NIN_SLIP: 'NIN_SLIP',
  INTERNATIONAL_PASSPORT: 'INTERNATIONAL_PASSPORT',
  DRIVERS_LICENSE: 'DRIVERS_LICENSE',
  VOTERS_CARD: 'VOTERS_CARD',
} as const;
export type IdDocumentType = (typeof IdDocumentType)[keyof typeof IdDocumentType];

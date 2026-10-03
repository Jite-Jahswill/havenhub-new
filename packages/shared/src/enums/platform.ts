/** Listing types whose publication can require admin review (the moderation policy). */
export const ModeratedListingType = {
  PROPERTY: 'PROPERTY',
  EVENT: 'EVENT',
  TOUR: 'TOUR',
  HOTEL: 'HOTEL',
  CLEANING: 'CLEANING',
} as const;
export type ModeratedListingType = (typeof ModeratedListingType)[keyof typeof ModeratedListingType];

export const MODERATED_LISTING_TYPES = Object.values(ModeratedListingType);

export const MODERATED_LISTING_LABELS: Record<ModeratedListingType, string> = {
  PROPERTY: 'Properties',
  EVENT: 'Events',
  TOUR: 'Tours',
  HOTEL: 'Hotels',
  CLEANING: 'Cleaning services',
};

/**
 * How the SMTP connection is encrypted. Unencrypted SMTP is not offered for
 * database-managed settings: the password would cross the network in clear.
 */
export const SmtpSecurity = {
  /** Implicit TLS from the first byte (usually port 465). */
  TLS: 'TLS',
  /** Plain connection upgraded with STARTTLS, which is required (usually 587). */
  STARTTLS: 'STARTTLS',
} as const;
export type SmtpSecurity = (typeof SmtpSecurity)[keyof typeof SmtpSecurity];

/** Ports accepted for database-managed SMTP (limits the server to mail ports). */
export const SMTP_PORTS = [25, 465, 587, 2525] as const;

/** Where the API's outgoing email settings come from right now. */
export const SmtpSource = {
  DATABASE: 'DATABASE',
  ENVIRONMENT: 'ENVIRONMENT',
  NONE: 'NONE',
} as const;
export type SmtpSource = (typeof SmtpSource)[keyof typeof SmtpSource];

/** `Retry-After` sent with maintenance responses: a re-check hint, not a promise. */
export const MAINTENANCE_RETRY_AFTER_SECONDS = 300;

/** Longest date range one analytics request may cover (keeps live queries bounded). */
export const ANALYTICS_MAX_RANGE_DAYS = 366;

/**
 * Events & experiences (Phase 6). Events, tours, hotels and cleaning services
 * are agent listings that share one lifecycle and moderation flow with
 * properties. They are catalogue-only: nothing can be purchased or booked yet.
 */
export const ExperienceKind = {
  EVENT: 'EVENT',
  TOUR: 'TOUR',
  HOTEL: 'HOTEL',
  CLEANING: 'CLEANING',
} as const;
export type ExperienceKind = (typeof ExperienceKind)[keyof typeof ExperienceKind];

export const EXPERIENCE_KINDS: readonly ExperienceKind[] = ['EVENT', 'TOUR', 'HOTEL', 'CLEANING'];

/** Same values and meaning as PropertyStatus (spec §47). */
export const ExperienceStatus = {
  DRAFT: 'DRAFT',
  PENDING_REVIEW: 'PENDING_REVIEW',
  PUBLISHED: 'PUBLISHED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type ExperienceStatus = (typeof ExperienceStatus)[keyof typeof ExperienceStatus];

/** Spec §22. */
export const TicketTypeKind = {
  REGULAR: 'REGULAR',
  VIP: 'VIP',
  VVIP: 'VVIP',
  EARLY_BIRD: 'EARLY_BIRD',
  GROUP: 'GROUP',
} as const;
export type TicketTypeKind = (typeof TicketTypeKind)[keyof typeof TicketTypeKind];

export const TICKET_TYPE_LABELS: Record<TicketTypeKind, string> = {
  REGULAR: 'Regular',
  VIP: 'VIP',
  VVIP: 'VVIP',
  EARLY_BIRD: 'Early Bird',
  GROUP: 'Group',
};

/** Spec §24. */
export const TourCategory = {
  ZOO_TOUR: 'ZOO_TOUR',
  CITY_TOUR: 'CITY_TOUR',
  CULTURAL_EXPERIENCE: 'CULTURAL_EXPERIENCE',
  ADVENTURE_ACTIVITY: 'ADVENTURE_ACTIVITY',
  TOURIST_ATTRACTION: 'TOURIST_ATTRACTION',
  GUIDED_TOUR: 'GUIDED_TOUR',
} as const;
export type TourCategory = (typeof TourCategory)[keyof typeof TourCategory];

export const TOUR_CATEGORY_LABELS: Record<TourCategory, string> = {
  ZOO_TOUR: 'Zoo tour',
  CITY_TOUR: 'City tour',
  CULTURAL_EXPERIENCE: 'Cultural experience',
  ADVENTURE_ACTIVITY: 'Adventure activity',
  TOURIST_ATTRACTION: 'Tourist attraction',
  GUIDED_TOUR: 'Guided tour',
};

export const Weekday = {
  MON: 'MON',
  TUE: 'TUE',
  WED: 'WED',
  THU: 'THU',
  FRI: 'FRI',
  SAT: 'SAT',
  SUN: 'SUN',
} as const;
export type Weekday = (typeof Weekday)[keyof typeof Weekday];

export const WEEKDAYS: readonly Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
  SUN: 'Sunday',
};

/** What each kind is called in the UI. */
export const EXPERIENCE_KIND_LABELS: Record<ExperienceKind, { one: string; many: string }> = {
  EVENT: { one: 'Event', many: 'Events' },
  TOUR: { one: 'Tour', many: 'Tours' },
  HOTEL: { one: 'Hotel', many: 'Hotels' },
  CLEANING: { one: 'Cleaning service', many: 'Cleaning services' },
};

/**
 * The plan allowance that limits each kind, or null when posting is not
 * limited. Cleaning services are never limited: §14 says cleaners do not pay
 * to post (CLEANING_SERVICE_COUNT is kept for future use, not enforced).
 */
export const EXPERIENCE_ENTITLEMENT = {
  EVENT: 'EVENT_COUNT',
  TOUR: 'TOUR_COUNT',
  HOTEL: 'HOTEL_COUNT',
  CLEANING: null,
} as const satisfies Record<ExperienceKind, string | null>;

/**
 * Technical anti-abuse bounds (not business rules): they keep any one
 * request, page and listing to a sane size.
 */
export const EXPERIENCE_LIMITS = {
  images: 30,
  videos: 10,
  ticketTypes: 10,
  tourDates: 200,
  roomTypes: 50,
  rooms: 500,
  /** Room availability dates changed in one request. */
  availabilityDays: 366,
  serviceAreas: 30,
  zoneExperiences: 50,
  zoneListItems: 30,
} as const;

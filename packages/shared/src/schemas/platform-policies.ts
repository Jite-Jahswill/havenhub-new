import { z } from 'zod';

import { MAX_ADVANCE_BOOKING_DAYS } from '../utils/stay.js';

/**
 * Admin-configurable platform policies, grouped by area. Every value has a
 * built-in default equal to HavenHub's behaviour before the setting existed,
 * so an empty or partial stored document behaves exactly like the defaults.
 *
 * `null` on a nullable number means "use the server's default" (an
 * environment variable such as BOOKING_HOLD_MINUTES).
 */

/** Hard ceilings the API enforces regardless of policy (upload parsers are sized to them). */
export const POLICY_LIMITS = {
  imageMaxMb: 10,
  chatAttachmentMaxMb: 50,
  maxAdvanceBookingDays: MAX_ADVANCE_BOOKING_DAYS,
} as const;

const int = (min: number, max: number) => z.number().int().min(min).max(max);
const flag = () => z.boolean();

/** Field shapes without defaults: the update schema accepts any subset of them. */
const FIELDS = {
  security: {
    /** Minimum length for new passwords (registration, reset, change). */
    passwordMinLength: int(10, 64),
    /** Days without activity before a sign-in expires (the lifetime restarts on every refresh). */
    sessionDays: int(1, 90).nullable(),
  },
  storage: {
    imageMaxMb: int(1, POLICY_LIMITS.imageMaxMb),
    /** Applied on top of each attachment kind's own limit. */
    chatAttachmentMaxMb: int(1, POLICY_LIMITS.chatAttachmentMaxMb),
  },
  booking: {
    /** Off: no new bookings; existing bookings and their payments continue. */
    enabled: flag(),
    holdMinutes: int(5, 24 * 60).nullable(),
    maxAdvanceDays: int(1, POLICY_LIMITS.maxAdvanceBookingDays),
    maxOpenHoldsPerCustomer: int(1, 10),
  },
  refunds: {
    /** A customer may cancel a paid booking (full refund) until this many days before check-in. */
    customerCancelCutoffDays: int(0, 365),
  },
  chat: {
    /** Off: no new listing/booking conversations (support and existing ones continue). */
    newConversations: flag(),
    attachments: flag(),
    /** 0 = messages cannot be edited. */
    editWindowMinutes: int(0, 24 * 60),
  },
  sales: {
    /** Off: buyers can only message agents through HavenHub chat. */
    contactEnabled: flag(),
    /** Shown to buyers before an agent's direct contact details; required to reveal them. */
    disclaimer: z.string().trim().max(5000).nullable(),
  },
  reviews: {
    /** Off: no new reviews (existing ones stay visible). */
    enabled: flag(),
    /** Days after check-out a customer may review the stay. */
    windowDays: int(7, 365),
  },
  events: {
    EVENT: flag(),
    TOUR: flag(),
    HOTEL: flag(),
    CLEANING: flag(),
  },
  notifications: {
    chatEmails: flag(),
    chatEmailDelayMinutes: int(0, 24 * 60).nullable(),
    /** 0 = no reminder before a subscription ends. */
    subscriptionExpiryReminderDays: int(0, 30),
    /** In-app notifications older than this are deleted. */
    inAppRetentionDays: int(30, 730),
  },
} as const;

export const POLICY_DEFAULTS = {
  security: { passwordMinLength: 10, sessionDays: null },
  storage: { imageMaxMb: POLICY_LIMITS.imageMaxMb, chatAttachmentMaxMb: 50 },
  booking: {
    enabled: true,
    holdMinutes: null,
    maxAdvanceDays: POLICY_LIMITS.maxAdvanceBookingDays,
    maxOpenHoldsPerCustomer: 3,
  },
  refunds: { customerCancelCutoffDays: 0 },
  chat: { newConversations: true, attachments: true, editWindowMinutes: 15 },
  sales: { contactEnabled: true, disclaimer: null },
  reviews: { enabled: true, windowDays: 60 },
  events: { EVENT: true, TOUR: true, HOTEL: true, CLEANING: true },
  notifications: {
    chatEmails: true,
    chatEmailDelayMinutes: null,
    subscriptionExpiryReminderDays: 3,
    inAppRetentionDays: 180,
  },
} as const satisfies {
  [A in PolicyArea]: { [K in keyof (typeof FIELDS)[A]]: z.output<(typeof FIELDS)[A][K]> };
};

export type PolicyArea = keyof typeof FIELDS;
export const POLICY_AREAS = Object.keys(FIELDS) as PolicyArea[];

export type PlatformPolicies = {
  [A in PolicyArea]: { [K in keyof (typeof FIELDS)[A]]: z.output<(typeof FIELDS)[A][K]> };
};

/** Parses one stored area; unknown keys are dropped, missing ones take their default. */
export function policyAreaSchema<A extends PolicyArea>(area: A) {
  const fields = FIELDS[area] as Record<string, z.ZodType>;
  const defaults = POLICY_DEFAULTS[area] as Record<string, unknown>;
  return z.object(
    Object.fromEntries(Object.entries(fields).map(([k, s]) => [k, s.default(defaults[k])])),
  ) as unknown as z.ZodType<PlatformPolicies[A]>;
}

/** Admin update: any subset of any areas; at least one value. */
export const updatePlatformPoliciesSchema = z
  .object(
    Object.fromEntries(
      POLICY_AREAS.map((area) => [
        area,
        z
          .object(FIELDS[area] as Record<string, z.ZodType>)
          .partial()
          .strict()
          .optional(),
      ]),
    ) as unknown as {
      [A in PolicyArea]: z.ZodOptional<
        z.ZodType<Partial<PlatformPolicies[A]>, Partial<PlatformPolicies[A]>>
      >;
    },
  )
  .strict()
  .refine((v) => Object.values(v).some((a) => a && Object.keys(a).length > 0), {
    message: 'Nothing to update',
  });
export type UpdatePlatformPoliciesInput = z.input<typeof updatePlatformPoliciesSchema>;

/** Admin view of the policies, with who changed them last. */
export interface PlatformPoliciesView {
  policies: PlatformPolicies;
  updatedAt: string | null;
}

/** The part of the policies the public site needs (part of `GET /platform/status`). */
export interface PublicPlatformPolicies {
  passwordMinLength: number;
  bookingsEnabled: boolean;
  experiences: PlatformPolicies['events'];
  chat: { newConversations: boolean; attachments: boolean };
}

export function publicPolicies(p: PlatformPolicies): PublicPlatformPolicies {
  return {
    passwordMinLength: p.security.passwordMinLength,
    bookingsEnabled: p.booking.enabled,
    experiences: p.events,
    chat: { newConversations: p.chat.newConversations, attachments: p.chat.attachments },
  };
}

// ── Admin form metadata ──

export interface PolicyFieldMeta {
  key: string;
  label: string;
  help: string;
  /** Number fields: bounds and unit; `defaultLabel` names what an empty value means. */
  type: 'boolean' | 'number' | 'text';
  min?: number;
  max?: number;
  unit?: string;
  defaultLabel?: string;
}

export interface PolicyAreaMeta {
  title: string;
  description: string;
  fields: PolicyFieldMeta[];
}

const num = (
  area: PolicyArea,
  key: string,
  label: string,
  help: string,
  unit: string,
  defaultLabel?: string,
): PolicyFieldMeta => {
  const schema = (FIELDS[area] as Record<string, z.ZodType>)[key];
  const inner = (schema instanceof z.ZodNullable ? schema.unwrap() : schema) as z.ZodNumber;
  return {
    key,
    label,
    help,
    type: 'number',
    min: inner.minValue ?? undefined,
    max: inner.maxValue ?? undefined,
    unit,
    ...(defaultLabel ? { defaultLabel } : {}),
  };
};
const bool = (key: string, label: string, help: string): PolicyFieldMeta => ({
  key,
  label,
  help,
  type: 'boolean',
});

export const POLICY_AREA_META: Record<PolicyArea, PolicyAreaMeta> = {
  security: {
    title: 'Security',
    description: 'Password length and when inactive people are signed out.',
    fields: [
      num(
        'security',
        'passwordMinLength',
        'Minimum password length',
        'Applies to new passwords: registration, password reset and password change. Existing passwords keep working.',
        'characters',
      ),
      num(
        'security',
        'sessionDays',
        'Sign out after inactivity',
        'People are signed out after this many days without using HavenHub (counted from their last visit). Leave empty to use the server default.',
        'days',
        'Server default',
      ),
    ],
  },
  storage: {
    title: 'Storage & uploads',
    description: 'Largest image and chat attachment people can upload.',
    fields: [
      num(
        'storage',
        'imageMaxMb',
        'Largest image upload',
        'Listing, profile and content images.',
        'MB',
      ),
      num(
        'storage',
        'chatAttachmentMaxMb',
        'Largest chat attachment',
        'Each file type also keeps its own limit (images 10 MB, video 50 MB, audio 15 MB, documents 20 MB); the smaller one applies.',
        'MB',
      ),
    ],
  },
  booking: {
    title: 'Booking',
    description: 'Whether new bookings are accepted, and their limits.',
    fields: [
      bool(
        'enabled',
        'Accept new bookings',
        'Off: customers cannot start new bookings. Existing bookings, payments and cancellations continue.',
      ),
      num(
        'booking',
        'holdMinutes',
        'Unpaid booking hold',
        'How long dates are held while the customer pays. Leave empty to use the server default.',
        'minutes',
        'Server default',
      ),
      num(
        'booking',
        'maxAdvanceDays',
        'Book up to',
        'How far ahead a stay can start.',
        'days ahead',
      ),
      num(
        'booking',
        'maxOpenHoldsPerCustomer',
        'Unpaid bookings per customer',
        'How many unpaid bookings one customer may hold at once.',
        'bookings',
      ),
    ],
  },
  refunds: {
    title: 'Cancellations & refunds',
    description: 'When customers can cancel a paid booking for a full refund.',
    fields: [
      num(
        'refunds',
        'customerCancelCutoffDays',
        'Customer cancellation cut-off',
        'Customers may cancel a paid booking (full refund, reviewed by finance) until this many days before check-in. 0 = until the stay starts. Agents and administrators are not affected.',
        'days before check-in',
      ),
    ],
  },
  chat: {
    title: 'Chat',
    description: 'Starting conversations, attachments and message editing.',
    fields: [
      bool(
        'newConversations',
        'Allow new conversations',
        'Off: no new conversations about listings or bookings. Support conversations and existing conversations continue.',
      ),
      bool('attachments', 'Allow attachments', 'Off: new files cannot be uploaded to chat.'),
      num(
        'chat',
        'editWindowMinutes',
        'Message edit window',
        'How long after sending a message its author can edit it. 0 = no editing.',
        'minutes',
      ),
    ],
  },
  sales: {
    title: 'Property sales',
    description:
      'Contact for sale: whether buyers may contact agents directly, and the notice they accept first.',
    fields: [
      bool(
        'contactEnabled',
        'Allow contact for sale',
        'On: buyers can see an agent’s phone and email after accepting the notice below. Off: they can only message agents through HavenHub chat.',
      ),
      {
        key: 'disclaimer',
        label: 'Notice buyers must accept',
        help: 'Shown before an agent’s contact details; buyers tick that they accept it, and the exact wording is kept. Until it is set, contact details are not shown. Have it reviewed by your lawyer.',
        type: 'text',
        max: 5000,
      },
    ],
  },
  reviews: {
    title: 'Reviews',
    description: 'Whether customers can review stays, and for how long after check-out.',
    fields: [
      bool(
        'enabled',
        'Accept new reviews',
        'Off: customers cannot write new reviews. Published reviews stay visible.',
      ),
      num(
        'reviews',
        'windowDays',
        'Time to review',
        'How long after check-out a customer can review their stay.',
        'days',
      ),
    ],
  },
  events: {
    title: 'Events & experiences',
    description: 'Which experience types are offered on HavenHub.',
    fields: [
      bool(
        'EVENT',
        'Events',
        'Off: hidden from the public site and agents cannot create new ones. Existing listings are kept.',
      ),
      bool('TOUR', 'Tours', 'Same as above, for tours.'),
      bool('HOTEL', 'Hotels', 'Same as above, for hotels.'),
      bool('CLEANING', 'Cleaning services', 'Same as above, for cleaning services.'),
    ],
  },
  notifications: {
    title: 'Notifications',
    description: 'Which emails HavenHub sends, and how long in-app notifications are kept.',
    fields: [
      bool(
        'chatEmails',
        'Email unread chat messages',
        'Off: no emails about unread chat messages (in-app updates continue).',
      ),
      num(
        'notifications',
        'chatEmailDelayMinutes',
        'Unread chat email delay',
        'How long a message stays unread before the email is sent. Leave empty to use the server default.',
        'minutes',
        'Server default',
      ),
      num(
        'notifications',
        'subscriptionExpiryReminderDays',
        'Subscription ending reminder',
        'Days before an agent subscription ends that the reminder email is sent. 0 = no reminder.',
        'days before',
      ),
      num(
        'notifications',
        'inAppRetentionDays',
        'Keep in-app notifications for',
        'Older notifications are deleted from everyone’s inbox, read or not.',
        'days',
      ),
    ],
  },
};

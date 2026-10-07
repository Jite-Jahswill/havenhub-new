import { z } from 'zod';

import { emailField } from './fields.js';
import { paginationQuerySchema } from './admin.js';

/**
 * In-app notifications: what a user's inbox contains. The type says what
 * happened; title, body and link are written when the notification is
 * created and shown as stored.
 */
export const NotificationType = {
  BOOKING_CONFIRMED: 'BOOKING_CONFIRMED',
  BOOKING_RECEIVED: 'BOOKING_RECEIVED',
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  BOOKING_EXPIRED: 'BOOKING_EXPIRED',
  REFUND_APPROVED: 'REFUND_APPROVED',
  REFUND_REJECTED: 'REFUND_REJECTED',
  REFUND_COMPLETED: 'REFUND_COMPLETED',
  LISTING_MODERATED: 'LISTING_MODERATED',
  AGENT_VERIFICATION: 'AGENT_VERIFICATION',
  SUBSCRIPTION: 'SUBSCRIPTION',
  PLAN_LIMIT_REACHED: 'PLAN_LIMIT_REACHED',
  REVIEW_RECEIVED: 'REVIEW_RECEIVED',
  ANNOUNCEMENT: 'ANNOUNCEMENT',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

/** Who an administrator's announcement goes to. */
export const NotificationAudience = {
  ALL: 'ALL',
  CUSTOMERS: 'CUSTOMERS',
  AGENTS: 'AGENTS',
  USER: 'USER',
} as const;
export type NotificationAudience = (typeof NotificationAudience)[keyof typeof NotificationAudience];

export const NOTIFICATION_AUDIENCE_LABELS: Record<NotificationAudience, string> = {
  ALL: 'Everyone (customers and agents)',
  CUSTOMERS: 'All customers',
  AGENTS: 'All agents',
  USER: 'One person (by email)',
};

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Relative path in the web app, or null. */
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationPage {
  items: NotificationView[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  unread: number;
}

export interface NotificationBroadcastView {
  id: string;
  audience: NotificationAudience;
  recipientEmail: string | null;
  title: string;
  body: string;
  link: string | null;
  recipientCount: number;
  sentBy: { id: string; fullName: string } | null;
  createdAt: string;
}

/** Real-time hint: the inbox changed (new or read); clients re-read the unread count. */
export type NotificationEventPayloads = {
  'notifications.changed': { eventId: string };
};

export const notificationListQuerySchema = paginationQuerySchema.extend({
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type NotificationListQuery = z.input<typeof notificationListQuerySchema>;

/** A path inside the web app: "/…", no scheme, host or protocol-relative "//". */
export const relativeLinkField = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^\/(?!\/)[^\s\\]*$/.test(v), {
    message: 'Use a path on this site, starting with "/" (for example /properties)',
  });

export const sendBroadcastSchema = z
  .object({
    audience: z.enum(NotificationAudience),
    email: emailField.optional(),
    title: z.string().trim().min(3, 'Enter a title').max(160),
    body: z.string().trim().min(1, 'Enter a message').max(1000),
    link: relativeLinkField
      .or(z.literal(''))
      .optional()
      .transform((v) => v || null),
  })
  .strict()
  .refine((v) => v.audience !== 'USER' || Boolean(v.email), {
    path: ['email'],
    message: 'Enter the email address of the person to notify',
  });
export type SendBroadcastInput = z.input<typeof sendBroadcastSchema>;

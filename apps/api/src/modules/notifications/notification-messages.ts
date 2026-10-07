import { NotificationType } from '@havenhub/shared';

import type { NotificationInput } from './notifications.service';

/**
 * Wording of every system notification, in one place. Each builder returns
 * the inbox entries for one event; links are web-app paths for the
 * recipient's own dashboard.
 */

/** Booking dates are calendar dates (stored as UTC midnight). */
const day = (d: Date) =>
  d.toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

interface BookingFacts {
  id: string;
  reference: string;
  title: string;
  startDate: Date;
  endDate: Date;
  customerId: string;
  agentUserId: string;
}

const stay = (b: BookingFacts) => `${b.title}, ${day(b.startDate)} – ${day(b.endDate)}`;

export const bookingMessages = {
  confirmed: (b: BookingFacts): NotificationInput[] => [
    {
      userId: b.customerId,
      type: NotificationType.BOOKING_CONFIRMED,
      title: 'Booking confirmed',
      body: `Your payment was received and your stay is confirmed: ${stay(b)}. Reference ${b.reference}.`,
      link: `/account/bookings/${b.id}`,
    },
    {
      userId: b.agentUserId,
      type: NotificationType.BOOKING_RECEIVED,
      title: 'New booking',
      body: `A paid booking was confirmed: ${stay(b)}. Reference ${b.reference}.`,
      link: `/agent/bookings/${b.id}`,
    },
  ],

  /** Both sides are told, except whoever cancelled. */
  cancelled: (b: BookingFacts, actorId: string | null, refunded: boolean): NotificationInput[] =>
    [
      {
        userId: b.customerId,
        type: NotificationType.BOOKING_CANCELLED,
        title: 'Booking cancelled',
        body: `Your booking ${b.reference} (${stay(b)}) was cancelled.${
          refunded ? ' A full refund has been requested; we will let you know when it is sent.' : ''
        }`,
        link: `/account/bookings/${b.id}`,
      },
      {
        userId: b.agentUserId,
        type: NotificationType.BOOKING_CANCELLED,
        title: 'Booking cancelled',
        body: `Booking ${b.reference} (${stay(b)}) was cancelled and its dates are free again.`,
        link: `/agent/bookings/${b.id}`,
      },
    ].filter((n) => n.userId !== actorId),

  expired: (b: BookingFacts): NotificationInput[] => [
    {
      userId: b.customerId,
      type: NotificationType.BOOKING_EXPIRED,
      title: 'Booking hold expired',
      body: `Payment for ${stay(b)} was not completed in time, so the dates were released. You can book again if they are still free.`,
      link: `/account/bookings/${b.id}`,
    },
  ],
};

const naira = (kobo: bigint) =>
  `₦${(Number(kobo) / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

interface RefundFacts {
  customerId: string;
  bookingId: string;
  reference: string;
  amountKobo: bigint;
  note: string | null;
}

export const refundMessages = {
  approved: (r: RefundFacts): NotificationInput => ({
    userId: r.customerId,
    type: NotificationType.REFUND_APPROVED,
    title: 'Refund approved',
    body: `Your refund of ${naira(r.amountKobo)} for booking ${r.reference} was approved and is being sent to your payment method.`,
    link: `/account/bookings/${r.bookingId}`,
  }),
  rejected: (r: RefundFacts): NotificationInput => ({
    userId: r.customerId,
    type: NotificationType.REFUND_REJECTED,
    title: 'Refund not approved',
    body: `Your refund request for booking ${r.reference} was not approved.${
      r.note ? ` Reason: ${r.note}` : ''
    } Contact support if you have questions.`,
    link: `/account/bookings/${r.bookingId}`,
  }),
  completed: (r: RefundFacts): NotificationInput => ({
    userId: r.customerId,
    type: NotificationType.REFUND_COMPLETED,
    title: 'Refund sent',
    body: `${naira(r.amountKobo)} for booking ${r.reference} has been refunded. Your bank may take a few days to show it.`,
    link: `/account/bookings/${r.bookingId}`,
  }),
};

const MODERATION_WORDING: Record<string, { title: string; text: string }> = {
  APPROVE: { title: 'Listing approved', text: 'was approved and is now live' },
  REJECT: { title: 'Listing not approved', text: 'was not approved' },
  SUSPEND: { title: 'Listing suspended', text: 'was suspended and is hidden from the public' },
  RESTORE: { title: 'Listing restored', text: 'was restored' },
};

export function listingModerated(input: {
  agentUserId: string;
  action: string;
  title: string;
  note: string | null;
  link: string;
}): NotificationInput {
  const w = MODERATION_WORDING[input.action] ?? {
    title: 'Listing updated',
    text: 'was reviewed',
  };
  return {
    userId: input.agentUserId,
    type: NotificationType.LISTING_MODERATED,
    title: w.title,
    body: `“${input.title}” ${w.text}.${input.note ? ` Note from the reviewer: ${input.note}` : ''}`,
    link: input.link,
  };
}

const VERIFICATION_WORDING: Record<string, { title: string; text: string }> = {
  UNDER_REVIEW: { title: 'Verification in review', text: 'Your agent details are being reviewed.' },
  VERIFIED: {
    title: 'You are verified',
    text: 'Your agent account is verified. Your published listings can now appear on HavenHub.',
  },
  REJECTED: {
    title: 'Verification not approved',
    text: 'Your agent verification was not approved. Update your details and submit again.',
  },
  SUSPENDED: {
    title: 'Agent account suspended',
    text: 'Your agent account is suspended and your listings are hidden.',
  },
  BLOCKED: { title: 'Agent account blocked', text: 'Your agent account has been blocked.' },
  PENDING: {
    title: 'Verification reopened',
    text: 'Your agent verification needs to be submitted again.',
  },
};

export function agentVerification(input: {
  agentUserId: string;
  status: string;
  note: string | null;
}): NotificationInput {
  const w = VERIFICATION_WORDING[input.status] ?? {
    title: 'Verification updated',
    text: 'Your agent verification status changed.',
  };
  return {
    userId: input.agentUserId,
    type: NotificationType.AGENT_VERIFICATION,
    title: w.title,
    body: `${w.text}${input.note ? ` Note: ${input.note}` : ''}`,
    link: '/agent/profile',
  };
}

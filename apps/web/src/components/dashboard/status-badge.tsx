import type {
  AgentEarningStatus,
  AgentVerificationStatus,
  BookingStatus,
  PaymentStatus,
  PropertyStatus,
  RefundStatus,
  UserStatus,
} from '@havenhub/shared';
import { Badge, type BadgeProps } from '@havenhub/ui';

import {
  BOOKING_STATUS_LABELS,
  EARNING_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  PROPERTY_STATUS_LABELS,
  REFUND_STATUS_LABELS,
} from '@/lib/labels';

const VERIFICATION: Record<AgentVerificationStatus, { label: string; tone: BadgeProps['tone'] }> = {
  PENDING: { label: 'Not submitted', tone: 'neutral' },
  UNDER_REVIEW: { label: 'Under review', tone: 'warning' },
  VERIFIED: { label: 'Verified', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'error' },
  SUSPENDED: { label: 'Suspended', tone: 'error' },
  BLOCKED: { label: 'Blocked', tone: 'error' },
};

const USER_STATUS: Record<UserStatus, { label: string; tone: BadgeProps['tone'] }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  SUSPENDED: { label: 'Suspended', tone: 'warning' },
  BLOCKED: { label: 'Blocked', tone: 'error' },
};

export const verificationLabel = (status: AgentVerificationStatus) => VERIFICATION[status].label;

export function VerificationBadge({ status }: { status: AgentVerificationStatus }) {
  const { label, tone } = VERIFICATION[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const { label, tone } = USER_STATUS[status];
  return <Badge tone={tone}>{label}</Badge>;
}

const PROPERTY_TONES: Record<PropertyStatus, BadgeProps['tone']> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'warning',
  PUBLISHED: 'success',
  REJECTED: 'error',
  SUSPENDED: 'error',
  ARCHIVED: 'neutral',
};

export function PropertyStatusBadge({ status }: { status: PropertyStatus }) {
  return <Badge tone={PROPERTY_TONES[status]}>{PROPERTY_STATUS_LABELS[status]}</Badge>;
}

const BOOKING_TONES: Record<BookingStatus, BadgeProps['tone']> = {
  AWAITING_PAYMENT: 'warning',
  CONFIRMED: 'success',
  CANCELLED: 'error',
  EXPIRED: 'neutral',
  COMPLETED: 'neutral',
};

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return <Badge tone={BOOKING_TONES[status]}>{BOOKING_STATUS_LABELS[status]}</Badge>;
}

const PAYMENT_TONES: Record<PaymentStatus, BadgeProps['tone']> = {
  PENDING: 'warning',
  SUCCESS: 'success',
  FAILED: 'error',
  REFUNDED: 'neutral',
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge tone={PAYMENT_TONES[status]}>{PAYMENT_STATUS_LABELS[status]}</Badge>;
}

const REFUND_TONES: Record<RefundStatus, BadgeProps['tone']> = {
  REQUESTED: 'warning',
  PROCESSING: 'warning',
  COMPLETED: 'success',
  REJECTED: 'error',
  FAILED: 'error',
};

export function RefundStatusBadge({ status }: { status: RefundStatus }) {
  return <Badge tone={REFUND_TONES[status]}>{REFUND_STATUS_LABELS[status]}</Badge>;
}

const EARNING_TONES: Record<AgentEarningStatus, BadgeProps['tone']> = {
  PENDING: 'warning',
  AVAILABLE: 'success',
  REVERSED: 'neutral',
};

export function EarningStatusBadge({ status }: { status: AgentEarningStatus }) {
  return <Badge tone={EARNING_TONES[status]}>{EARNING_STATUS_LABELS[status]}</Badge>;
}

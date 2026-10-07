import type { BookingReviewState } from '../schemas/review.js';
import type { AppliedDiscount } from '../schemas/discount.js';
import type {
  AgentEarningStatus,
  BookingStatus,
  CancelledBy,
  LedgerEntryType,
  PaymentProviderName,
  PaymentStatus,
  PriceLineKind,
  RefundStatus,
} from '../enums/booking.js';
import type { CleaningOption, PropertyType } from '../enums/property.js';
import type { LedgerSummary } from '../utils/ledger.js';
import type { RentalPeriod } from '../utils/stay.js';

/** All money values are integer kobo. */

export interface PriceLine {
  kind: PriceLineKind;
  label: string;
  /** Negative for discounts. */
  amountKobo: number;
  quantity: number | null;
  unitAmountKobo: number | null;
}

export interface BookingQuote {
  propertyId: string;
  pricingPeriod: RentalPeriod;
  startDate: string;
  /** Check-out day (exclusive). */
  endDate: string;
  quantity: number;
  guests: number | null;
  addCleaning: boolean;
  available: boolean;
  /** Why the request cannot be booked, when `available` is false. */
  unavailableReason: string | null;
  /** Customer-facing lines; they sum to `totalKobo`. */
  lines: PriceLine[];
  totalKobo: number;
  /** Part of the total that is a refundable caution deposit. */
  refundableDepositKobo: number;
  /** The promo code applied, if one was given and is valid. */
  promo: AppliedDiscount | null;
  currency: 'NGN';
}

export interface PropertyAvailability {
  propertyId: string;
  pricingPeriod: RentalPeriod;
  /** Earliest bookable start date. */
  earliestStartDate: string;
  latestStartDate: string;
  limits: { min: number; max: number; unit: string };
  /** Booked ranges [startDate, endDate) — no customer data. */
  unavailable: { startDate: string; endDate: string }[];
  /** Present when a startDate/quantity was supplied. */
  check: {
    startDate: string;
    endDate: string;
    available: boolean;
    reason: string | null;
  } | null;
}

/** What the booking captured about the property when it was made. */
export interface BookingPropertySnapshot {
  id: string;
  slug: string;
  title: string;
  propertyType: PropertyType;
  pricingPeriod: RentalPeriod;
  unitPriceKobo: number;
  discountPercent: number | null;
  cleaningOption: CleaningOption | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  coverThumbnailUrl: string | null;
}

export interface PaymentView {
  id: string;
  reference: string;
  provider: PaymentProviderName;
  status: PaymentStatus;
  amountKobo: number;
  currency: 'NGN';
  failureReason: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface RefundView {
  id: string;
  status: RefundStatus;
  amountKobo: number;
  reason: string;
  reviewNote: string | null;
  requestedBy: CancelledBy;
  createdAt: string;
  completedAt: string | null;
}

export interface CancellationView {
  cancelledAt: string;
  cancelledBy: CancelledBy;
  reason: string | null;
}

export interface BookingSummary {
  id: string;
  reference: string;
  status: BookingStatus;
  /** Status of the payment that settled (or is settling) this booking. */
  paymentStatus: PaymentStatus | null;
  property: Pick<
    BookingPropertySnapshot,
    'id' | 'slug' | 'title' | 'city' | 'state' | 'coverThumbnailUrl'
  >;
  pricingPeriod: RentalPeriod;
  startDate: string;
  endDate: string;
  quantity: number;
  totalKobo: number;
  holdExpiresAt: string | null;
  createdAt: string;
}

export interface CustomerBookingDetail extends BookingSummary, BookingReviewState {
  snapshot: BookingPropertySnapshot;
  guests: number | null;
  cleaningSelected: boolean;
  lines: PriceLine[];
  refundableDepositKobo: number;
  agent: { id: string; displayName: string };
  confirmedAt: string | null;
  cancellation: CancellationView | null;
  payments: PaymentView[];
  refund: RefundView | null;
  canPay: boolean;
  canCancel: boolean;
  /** What a cancellation now would return to the customer. */
  cancellationRefundKobo: number;
}

/** The agent's share of one booking. */
export interface AgentBookingFinancials {
  /** Rent after listing discount. */
  stayKobo: number;
  cleaningKobo: number;
  commissionKobo: number;
  payoutKobo: number;
  /** Collected by HavenHub, not the agent's money. */
  vatKobo: number;
  cautionKobo: number;
  earningStatus: AgentEarningStatus | null;
}

export interface AgentBookingListItem extends BookingSummary {
  customerName: string;
  payoutKobo: number;
  earningStatus: AgentEarningStatus | null;
}

export interface AgentBookingDetail extends AgentBookingListItem {
  snapshot: BookingPropertySnapshot;
  guests: number | null;
  cleaningSelected: boolean;
  /** Contact details are shared only once a booking is confirmed. */
  customer: { fullName: string; email: string | null; phone: string | null };
  lines: PriceLine[];
  financials: AgentBookingFinancials;
  confirmedAt: string | null;
  cancellation: CancellationView | null;
  refund: RefundView | null;
  canCancel: boolean;
}

export interface AgentEarningsSummary {
  /** Bookings with captured payments (confirmed, completed, or cancelled after payment). */
  paidBookings: number;
  /** Sum of stay + cleaning before commission. */
  grossKobo: number;
  commissionKobo: number;
  /** Earned on confirmed bookings, not yet payable. */
  pendingKobo: number;
  /** Payable — withdrawals arrive in a later phase. */
  availableKobo: number;
  /** Earnings reversed by refunds. */
  reversedKobo: number;
  /** VAT collected on the agent's bookings (remitted by HavenHub). */
  vatKobo: number;
  withdrawalsAvailable: false;
}

export interface LedgerEntryView {
  id: string;
  type: LedgerEntryType;
  amountKobo: number;
  paymentId: string | null;
  refundId: string | null;
  createdAt: string;
}

export interface PlatformBookingFinancials {
  serviceFeeKobo: number;
  agentCommissionKobo: number;
  vatKobo: number;
  cautionKobo: number;
  agentPayoutKobo: number;
  pricingConfigVersion: number;
}

export interface AdminBookingListItem extends BookingSummary {
  customer: { id: string; fullName: string; email: string };
  agent: { id: string; displayName: string };
}

export interface AdminBookingDetail extends AdminBookingListItem {
  snapshot: BookingPropertySnapshot;
  guests: number | null;
  cleaningSelected: boolean;
  lines: PriceLine[];
  financials: PlatformBookingFinancials;
  earningStatus: AgentEarningStatus | null;
  confirmedAt: string | null;
  cancellation: CancellationView | null;
  payments: PaymentView[];
  refunds: RefundView[];
  ledger: LedgerEntryView[];
  /** Net ledger position by bucket; null without `payments.view`. */
  ledgerSummary: LedgerSummary | null;
  canCancel: boolean;
}

export interface AdminPaymentListItem extends PaymentView {
  booking: { id: string; reference: string; status: BookingStatus };
  customer: { id: string; fullName: string; email: string };
}

export interface AdminRefundListItem extends RefundView {
  booking: { id: string; reference: string };
  customer: { id: string; fullName: string; email: string };
  payment: { reference: string; provider: PaymentProviderName };
}

export interface PricingConfigView {
  version: number;
  serviceFeeBps: number;
  agentCommissionBps: number;
  vatBps: number;
  vatOnServiceFee: boolean;
  vatOnStay: boolean;
  note: string | null;
  createdAt: string;
  createdBy: { id: string; fullName: string } | null;
}

export interface PaymentInitView {
  reference: string;
  provider: PaymentProviderName;
  /** Where to send the customer to pay. */
  authorizationUrl: string;
  amountKobo: number;
}

export interface PaymentVerificationView {
  reference: string;
  paymentStatus: PaymentStatus;
  bookingId: string;
  bookingStatus: BookingStatus;
}

export interface TestCheckoutView {
  reference: string;
  amountKobo: number;
  bookingId: string;
  bookingReference: string;
  propertyTitle: string;
  status: PaymentStatus;
}

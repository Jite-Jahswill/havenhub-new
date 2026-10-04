import { randomBytes } from 'node:crypto';

import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  AgentEarningStatus,
  BookingStatus,
  CancelledBy,
  ErrorCode,
  PaymentStatus,
  type PaymentInitView,
  type PaymentVerificationView,
  type TestCheckoutView,
} from '@havenhub/shared';

import { AppException, Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { koboToNumber } from '../../common/money';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { Payment, Prisma } from '../../generated/prisma/client';
import { describeError } from '../../common/logging/describe-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { snapshotOf } from '../bookings/booking.mapper';
import { BookingStateService } from '../bookings/booking-state.service';
import { LedgerService } from '../finance/ledger.service';
import {
  PaymentProviderError,
  verificationMismatch,
  type ProviderVerification,
} from '../finance/providers/payment-provider';
import { PaymentProviders } from '../finance/providers/payment-providers.service';
import { TestPaymentProvider } from '../finance/providers/test-payment.provider';
import { RefundsService } from '../finance/refunds.service';

type Tx = Prisma.TransactionClient;

/**
 * Takes payments for bookings through the active provider and settles them.
 *
 * Settlement trusts only the provider's server-side verification, and checks
 * reference, amount and currency against what we asked for. It runs under a
 * row lock and is idempotent: a payment settles once, however many callbacks
 * or webhooks arrive, so the booking is confirmed once and the ledger and
 * agent earning are written once.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: PaymentProviders,
    private readonly testProvider: TestPaymentProvider,
    private readonly ledger: LedgerService,
    private readonly refunds: RefundsService,
    private readonly bookingState: BookingStateService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Starts a payment attempt for the customer's unpaid booking. Retries create new attempts. */
  async initiate(
    customer: { id: string; email: string },
    bookingId: string,
    meta: RequestMeta,
  ): Promise<PaymentInitView> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, customerId: customer.id },
    });
    if (!booking) throw Errors.notFound('Booking');
    if (booking.status !== BookingStatus.AWAITING_PAYMENT) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATUS_TRANSITION,
        `This booking is ${booking.status.toLowerCase().replace('_', ' ')} and cannot be paid.`,
      );
    }
    if (!booking.holdExpiresAt || booking.holdExpiresAt <= new Date()) {
      await this.prisma.$transaction((tx) =>
        this.bookingState.expireStaleHolds(tx, { id: booking.id }),
      );
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.BOOKING_HOLD_EXPIRED,
        'This booking was not paid in time and has expired. Please book again.',
      );
    }

    const provider = this.providers.active();
    const payment = await this.prisma.payment.create({
      data: {
        bookingId: booking.id,
        provider: provider.name,
        reference: `HHP-${randomBytes(12).toString('hex')}`,
        amountKobo: booking.totalKobo,
        currency: booking.currency,
      },
    });
    await this.audit.record({
      actorId: customer.id,
      action: 'payment.initiated',
      resourceType: 'payment',
      resourceId: payment.id,
      after: {
        bookingId: booking.id,
        reference: payment.reference,
        provider: payment.provider,
        amountKobo: payment.amountKobo.toString(),
      },
      meta,
    });

    try {
      const { authorizationUrl } = await provider.initialize({
        reference: payment.reference,
        amountKobo: payment.amountKobo,
        currency: 'NGN',
        email: customer.email,
        callbackUrl: `${this.env.WEB_APP_URL}/account/bookings/${booking.id}`,
        metadata: { bookingId: booking.id, bookingReference: booking.reference },
      });
      return {
        reference: payment.reference,
        provider: payment.provider,
        authorizationUrl,
        amountKobo: koboToNumber(payment.amountKobo),
      };
    } catch (error) {
      this.logger.error('Could not start a payment with the provider', {
        event: 'payment.initiate_failed',
        kind: 'booking',
        reference: payment.reference,
        ...describeError(error),
      });
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED, failureReason: 'Could not start the payment' },
      });
      throw providerUnavailable();
    }
  }

  /** The customer returned from checkout: verify their own payment. */
  async verifyForCustomer(customerId: string, reference: string): Promise<PaymentVerificationView> {
    const payment = await this.prisma.payment.findFirst({
      where: { reference, booking: { customerId } },
      select: { id: true },
    });
    if (!payment) throw Errors.notFound('Payment');
    return this.settle(reference);
  }

  /**
   * Settles one payment from the provider's own record. Safe to call any
   * number of times, from any source (redirect, webhook, admin re-check).
   */
  async settle(reference: string): Promise<PaymentVerificationView> {
    const payment = await this.prisma.payment.findUnique({ where: { reference } });
    if (!payment) throw Errors.notFound('Payment');
    if (payment.status !== PaymentStatus.PENDING) return this.view(payment.id);

    let verification: ProviderVerification;
    try {
      verification = await this.providers.get(payment.provider).verify(reference);
    } catch (error) {
      if (error instanceof PaymentProviderError) {
        this.logger.warn('Payment verification with the provider failed', {
          event: 'payment.verification_failed',
          kind: 'booking',
          reference,
          outcomeUnknown: error.outcomeUnknown,
          ...describeError(error),
        });
        throw new AppException(
          HttpStatus.BAD_GATEWAY,
          ErrorCode.PAYMENT_VERIFICATION_FAILED,
          'We could not confirm this payment with the payment provider yet. Please try again shortly.',
        );
      }
      throw error;
    }
    if (verification.status === 'pending') return this.view(payment.id);

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${payment.id}::uuid FOR UPDATE`;
      const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      if (current.status !== PaymentStatus.PENDING) return; // settled concurrently

      if (verification.status === 'failed') {
        await this.markFailed(tx, current, verification.message ?? 'Payment was not completed');
        return;
      }
      const mismatch = verificationMismatch(current, verification);
      if (mismatch) {
        // Money may have moved, but not as agreed: never confirm; flag for review.
        await this.markFailed(
          tx,
          current,
          `Verification mismatch: ${mismatch}`,
          'payment.verification_mismatch',
        );
        return;
      }
      await this.markSucceeded(tx, current, verification);
    });
    return this.view(payment.id);
  }

  private async markSucceeded(tx: Tx, payment: Payment, verification: ProviderVerification) {
    const now = new Date();
    const paid = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.SUCCESS,
        providerTransactionId: verification.providerTransactionId,
        paidAt: verification.paidAt ?? now,
        verifiedAt: now,
        failureReason: null,
      },
    });
    await this.audit.record(
      {
        actorId: null,
        action: 'payment.succeeded',
        resourceType: 'payment',
        resourceId: payment.id,
        before: { status: payment.status },
        after: { status: paid.status, amountKobo: paid.amountKobo.toString() },
      },
      tx,
    );

    const booking = await this.bookingState.lock(tx, payment.bookingId);
    if (booking.status === BookingStatus.AWAITING_PAYMENT) {
      // While unpaid and not expired the booking still holds its dates
      // exclusively, so confirming cannot create an overlap.
      const confirmed = await this.bookingState.transition(tx, booking, BookingStatus.CONFIRMED, {
        actorId: null,
        data: { confirmedAt: now, holdExpiresAt: null },
        detail: { paymentReference: payment.reference },
      });
      await this.ledger.recordBookingPayment(tx, paid, confirmed);
      await tx.agentEarning.create({
        data: {
          bookingId: booking.id,
          agentProfileId: booking.agentProfileId,
          amountKobo: booking.agentPayoutKobo,
          status: AgentEarningStatus.PENDING,
        },
      });
      return;
    }

    // Paid too late (expired / cancelled) or paid twice: keep the money
    // visible in the ledger and owe all of it back.
    await this.ledger.recordUnallocatedPayment(tx, paid);
    await this.refunds.requestInTx(tx, {
      payment: paid,
      reason:
        booking.status === BookingStatus.CONFIRMED || booking.status === BookingStatus.COMPLETED
          ? 'Duplicate payment for an already paid booking'
          : `Payment received after the booking was ${booking.status.toLowerCase()}`,
      requestedBy: CancelledBy.SYSTEM,
      actorId: null,
    });
  }

  private async markFailed(tx: Tx, payment: Payment, reason: string, action = 'payment.failed') {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.FAILED,
        failureReason: reason.slice(0, 300),
        verifiedAt: new Date(),
      },
    });
    await this.audit.record(
      {
        actorId: null,
        action,
        resourceType: 'payment',
        resourceId: payment.id,
        before: { status: payment.status },
        after: { status: PaymentStatus.FAILED, reason },
      },
      tx,
    );
  }

  private async view(paymentId: string): Promise<PaymentVerificationView> {
    const p = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { booking: { select: { id: true, status: true } } },
    });
    return {
      reference: p.reference,
      paymentStatus: p.status,
      bookingId: p.booking.id,
      bookingStatus: p.booking.status,
    };
  }

  // ── Development test checkout ────────────────────────────────────────────

  async testCheckout(customerId: string, reference: string): Promise<TestCheckoutView> {
    this.assertTestCheckout();
    const p = await this.prisma.payment.findFirst({
      where: { reference, provider: 'TEST', booking: { customerId } },
      include: { booking: true },
    });
    if (!p) throw Errors.notFound('Payment');
    return {
      reference: p.reference,
      amountKobo: koboToNumber(p.amountKobo),
      bookingId: p.booking.id,
      bookingReference: p.booking.reference,
      propertyTitle: snapshotOf(p.booking).title,
      status: p.status,
    };
  }

  /** Records the simulated outcome, then settles through the normal verification path. */
  async completeTestCheckout(
    customerId: string,
    reference: string,
    outcome: 'success' | 'failed',
  ): Promise<PaymentVerificationView> {
    const view = await this.testCheckout(customerId, reference);
    if (view.status === PaymentStatus.PENDING) await this.testProvider.simulate(reference, outcome);
    return this.settle(reference);
  }

  private assertTestCheckout() {
    if (!this.providers.testProviderEnabled) throw Errors.notFound('Page');
  }
}

const providerUnavailable = () =>
  new AppException(
    HttpStatus.BAD_GATEWAY,
    ErrorCode.PAYMENT_PROVIDER_ERROR,
    'We could not start the payment. Please try again in a moment.',
  );

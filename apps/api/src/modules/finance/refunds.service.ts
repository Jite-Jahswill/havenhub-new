import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  AgentEarningStatus,
  ErrorCode,
  LedgerEntryType,
  PaymentStatus,
  RefundStatus,
  type CancelledBy,
  type ReviewRefundInput,
} from '@havenhub/shared';

import { AppException, Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import type { Payment, Prisma, Refund } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { describeError } from '../../common/logging/describe-error';
import { AuditService } from '../audit/audit.service';
import { refundMessages } from '../notifications/notification-messages';
import { NotificationsService } from '../notifications/notifications.service';
import { LedgerService } from './ledger.service';
import { DistributedLockService } from '../../infrastructure/redis/distributed-lock.service';
import { PaymentProviderError } from './providers/payment-provider';
import { PaymentProviders } from './providers/payment-providers.service';

type Tx = Prisma.TransactionClient;

/** How long one refund's provider exchange may hold its lock. */
const DISPATCH_LOCK_MS = 60_000;

/**
 * Refunds (spec §30). One refund per payment — enforced by a unique key — so
 * money can never be returned twice. Phase 3 refunds are always full.
 *
 *   REQUESTED ─approve─▶ PROCESSING ─provider confirms─▶ COMPLETED
 *       │                    ├─provider refuses─▶ FAILED ─approve again─▶ PROCESSING
 *       │                    └─outcome unknown (timeout…): stays PROCESSING ─recheck─┘
 *       └─reject─▶ REJECTED
 *
 * Sending a refund to the provider is guarded so it can never happen twice
 * for one payment: every exchange runs under a per-refund lock, and before
 * any request the provider is asked whether a refund already exists (an
 * earlier attempt may have succeeded although its answer was lost). A
 * request is sent only when the provider definitely has none, or only a
 * failed one.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: PaymentProviders,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly locks: DistributedLockService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Opens a full refund of a successful payment inside the caller's
   * transaction. Idempotent: an existing refund for the payment is returned.
   */
  async requestInTx(
    tx: Tx,
    input: {
      payment: Payment;
      reason: string;
      requestedBy: CancelledBy;
      actorId: string | null;
      meta?: RequestMeta;
    },
  ): Promise<Refund> {
    const existing = await tx.refund.findUnique({ where: { paymentId: input.payment.id } });
    if (existing) return existing;
    if (input.payment.status !== PaymentStatus.SUCCESS) {
      throw new Error('Only successful payments can be refunded');
    }
    const refund = await tx.refund.create({
      data: {
        bookingId: input.payment.bookingId,
        paymentId: input.payment.id,
        amountKobo: input.payment.amountKobo,
        reason: input.reason.slice(0, 500),
        requestedBy: input.requestedBy,
      },
    });
    await this.audit.record(
      {
        actorId: input.actorId,
        action: 'refund.requested',
        resourceType: 'refund',
        resourceId: refund.id,
        after: {
          bookingId: refund.bookingId,
          paymentId: refund.paymentId,
          amountKobo: refund.amountKobo.toString(),
          requestedBy: refund.requestedBy,
        },
        meta: input.meta,
      },
      tx,
    );
    return refund;
  }

  /**
   * Admin decision. Approving sends the refund to the provider; RECHECK asks
   * the provider about a refund still PROCESSING (for example after a
   * timeout) and finishes, keeps waiting, or — only when the provider
   * definitely has no refund — sends it.
   */
  async review(
    actorId: string,
    refundId: string,
    input: ReviewRefundInput,
    meta: RequestMeta,
  ): Promise<Refund> {
    if (input.action === 'RECHECK') return this.recheck(actorId, refundId, input, meta);
    const refund = await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, refundId);
      const allowed: RefundStatus[] =
        input.action === 'APPROVE'
          ? [RefundStatus.REQUESTED, RefundStatus.FAILED]
          : [RefundStatus.REQUESTED];
      if (!allowed.includes(current.status)) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATUS_TRANSITION,
          `A ${current.status.toLowerCase()} refund cannot be ${input.action === 'APPROVE' ? 'approved' : 'rejected'}.`,
        );
      }
      const status = input.action === 'APPROVE' ? RefundStatus.PROCESSING : RefundStatus.REJECTED;
      const updated = await tx.refund.update({
        where: { id: refundId },
        data: {
          status,
          reviewNote: input.note ?? null,
          reviewedById: actorId,
          reviewedAt: new Date(),
          failureReason: null,
        },
      });
      await this.audit.record(
        {
          actorId,
          action: input.action === 'APPROVE' ? 'refund.approved' : 'refund.rejected',
          resourceType: 'refund',
          resourceId: refundId,
          before: { status: current.status },
          after: { status, note: input.note ?? null },
          meta,
        },
        tx,
      );
      const facts = await this.facts(tx, updated);
      await this.notifications.notify(tx, [
        input.action === 'APPROVE'
          ? refundMessages.approved(facts)
          : refundMessages.rejected(facts),
      ]);
      return updated;
    });
    if (refund.status !== RefundStatus.PROCESSING) return refund;
    return this.sendToProvider(refund.id, actorId, meta);
  }

  private async recheck(
    actorId: string,
    refundId: string,
    input: ReviewRefundInput,
    meta: RequestMeta,
  ): Promise<Refund> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, refundId);
      if (current.status !== RefundStatus.PROCESSING) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATUS_TRANSITION,
          `A ${current.status.toLowerCase()} refund cannot be re-checked.`,
        );
      }
      await this.audit.record(
        {
          actorId,
          action: 'refund.rechecked',
          resourceType: 'refund',
          resourceId: refundId,
          after: { note: input.note ?? null },
          meta,
        },
        tx,
      );
    });
    return this.sendToProvider(refundId, actorId, meta);
  }

  /**
   * The provider exchange for a PROCESSING refund, one at a time per refund.
   * Never sends a second request for money that may already have gone back.
   */
  private async sendToProvider(
    refundId: string,
    actorId: string,
    meta: RequestMeta,
  ): Promise<Refund> {
    let run;
    try {
      run = await this.locks.withLock(`refunds:dispatch:${refundId}`, DISPATCH_LOCK_MS, () =>
        this.exchange(refundId, actorId, meta),
      );
    } catch (error) {
      if (error instanceof AppException) throw error;
      // Without the lock (Redis unavailable) nothing is sent.
      this.logger.error('Refund lock unavailable; nothing sent', {
        event: 'refund.lock_unavailable',
        refundId,
        ...describeError(error),
      });
      throw busy();
    }
    if (!run.acquired) throw busy();
    return run.result;
  }

  private async exchange(refundId: string, actorId: string, meta: RequestMeta): Promise<Refund> {
    const refund = await this.prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
    if (refund.status !== RefundStatus.PROCESSING) return refund;
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: refund.paymentId },
    });
    let provider;
    try {
      provider = this.providers.get(payment.provider);
    } catch (error) {
      // No provider to ask: nothing was sent, the refund keeps waiting.
      return this.unknown(refund, (error as Error).message, actorId, meta);
    }
    const ids = {
      reference: payment.reference,
      providerTransactionId: payment.providerTransactionId,
    };

    // 1. Ask first: an earlier attempt may have worked though its answer was lost.
    let existing;
    try {
      existing = await provider.findRefund(ids);
    } catch (error) {
      return this.unknown(refund, providerMessage(error), actorId, meta);
    }
    if (existing.status === 'completed' || existing.status === 'processing') {
      return this.adopt(refund, existing, actorId, meta);
    }

    // 2. The provider definitely has no live refund: send one.
    let result;
    try {
      result = await provider.refund({
        reference: payment.reference,
        amountKobo: refund.amountKobo,
      });
    } catch (error) {
      if (error instanceof PaymentProviderError && !error.outcomeUnknown) {
        return this.refused(refund, provider, ids, error.message, actorId, meta);
      }
      return this.unknown(refund, providerMessage(error), actorId, meta);
    }
    if (result.status === 'failed') {
      return this.refused(
        refund,
        provider,
        ids,
        result.message ?? 'Refused by the payment provider',
        actorId,
        meta,
      );
    }
    return this.adopt(refund, result, actorId, meta);
  }

  /** The provider has (`completed`) or is processing a refund for this payment. */
  private async adopt(
    refund: Refund,
    found: { status: string; providerRefundId: string | null },
    actorId: string,
    meta: RequestMeta,
  ): Promise<Refund> {
    const withId =
      found.providerRefundId && found.providerRefundId !== refund.providerRefundId
        ? await this.prisma.refund.update({
            where: { id: refund.id },
            data: { providerRefundId: found.providerRefundId },
          })
        : refund;
    return found.status === 'completed' ? this.complete(refund.id, actorId, meta) : withId;
  }

  /**
   * The provider answered "no". If it already holds a refund for the payment
   * (say a retry is refused because the money went back earlier), adopt that;
   * otherwise the refund failed.
   */
  private async refused(
    refund: Refund,
    provider: ReturnType<PaymentProviders['get']>,
    ids: { reference: string; providerTransactionId: string | null },
    reason: string,
    actorId: string,
    meta: RequestMeta,
  ): Promise<Refund> {
    try {
      const existing = await provider.findRefund(ids);
      if (existing.status === 'completed' || existing.status === 'processing') {
        return this.adopt(refund, existing, actorId, meta);
      }
    } catch (error) {
      return this.unknown(refund, providerMessage(error), actorId, meta);
    }
    this.logger.warn('Refund refused by the provider', {
      event: 'refund.refused',
      refundId: refund.id,
    });
    return this.fail(refund.id, reason.slice(0, 300), actorId, meta);
  }

  /**
   * The outcome is unknown: the refund stays PROCESSING (never FAILED, which
   * would invite a second request) until a webhook or a RECHECK settles it.
   */
  private async unknown(
    refund: Refund,
    reason: string,
    actorId: string,
    meta: RequestMeta,
  ): Promise<Refund> {
    this.logger.warn('Refund outcome unknown; left processing', {
      event: 'refund.outcome_unknown',
      refundId: refund.id,
    });
    await this.audit.record({
      actorId,
      action: 'refund.outcome_unknown',
      resourceType: 'refund',
      resourceId: refund.id,
      after: { status: refund.status, reason: reason.slice(0, 300) },
      meta,
    });
    return refund;
  }

  /**
   * Final step, once the provider confirms the money went back. Idempotent:
   * a completed refund is returned unchanged, so a repeated provider webhook
   * cannot reverse the ledger twice.
   */
  async complete(refundId: string, actorId: string | null, meta?: RequestMeta): Promise<Refund> {
    return this.prisma.$transaction(async (tx) => {
      const refund = await this.lock(tx, refundId);
      if (refund.status === RefundStatus.COMPLETED) return refund;
      if (refund.status !== RefundStatus.PROCESSING) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATUS_TRANSITION,
          `A ${refund.status.toLowerCase()} refund cannot be completed.`,
        );
      }
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: refund.paymentId } });
      await this.ledger.recordRefund(tx, refund, payment);
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.REFUNDED },
      });

      // Only the payment that confirmed the booking funded the agent's earning.
      const unallocated = await tx.ledgerEntry.count({
        where: { sourceKey: `payment:${payment.id}`, type: LedgerEntryType.UNALLOCATED },
      });
      if (unallocated === 0) {
        await tx.agentEarning.updateMany({
          where: { bookingId: refund.bookingId, status: { not: AgentEarningStatus.REVERSED } },
          data: { status: AgentEarningStatus.REVERSED, reversedAt: new Date() },
        });
      }
      const completed = await tx.refund.update({
        where: { id: refundId },
        data: { status: RefundStatus.COMPLETED, completedAt: new Date(), failureReason: null },
      });
      await this.audit.record(
        {
          actorId,
          action: 'refund.completed',
          resourceType: 'refund',
          resourceId: refundId,
          before: { status: refund.status },
          after: { status: completed.status, amountKobo: completed.amountKobo.toString() },
          meta,
        },
        tx,
      );
      await this.notifications.notify(tx, [
        refundMessages.completed(await this.facts(tx, completed)),
      ]);
      return completed;
    });
  }

  /** Provider webhook: the refund for this payment reference was processed. */
  async completeByPaymentReference(reference: string): Promise<void> {
    const refund = await this.prisma.refund.findFirst({ where: { payment: { reference } } });
    if (!refund || refund.status === RefundStatus.COMPLETED) return;
    if (refund.status === RefundStatus.PROCESSING) await this.complete(refund.id, null);
  }

  async failByPaymentReference(reference: string, message: string | null): Promise<void> {
    const refund = await this.prisma.refund.findFirst({ where: { payment: { reference } } });
    if (refund?.status === RefundStatus.PROCESSING) {
      await this.fail(refund.id, message ?? 'Refund failed at the payment provider', null);
    }
  }

  private async fail(
    refundId: string,
    reason: string,
    actorId: string | null,
    meta?: RequestMeta,
  ): Promise<Refund> {
    return this.prisma.$transaction(async (tx) => {
      const refund = await this.lock(tx, refundId);
      if (refund.status !== RefundStatus.PROCESSING) return refund;
      const failed = await tx.refund.update({
        where: { id: refundId },
        data: { status: RefundStatus.FAILED, failureReason: reason },
      });
      await this.audit.record(
        {
          actorId,
          action: 'refund.failed',
          resourceType: 'refund',
          resourceId: refundId,
          before: { status: refund.status },
          after: { status: failed.status, reason },
          meta,
        },
        tx,
      );
      return failed;
    });
  }

  /** What a customer notification about this refund needs. */
  private async facts(tx: Tx, refund: Refund) {
    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: refund.bookingId },
      select: { id: true, reference: true, customerId: true },
    });
    return {
      customerId: booking.customerId,
      bookingId: booking.id,
      reference: booking.reference,
      amountKobo: refund.amountKobo,
      note: refund.reviewNote,
    };
  }

  private async lock(tx: Tx, refundId: string): Promise<Refund> {
    await tx.$queryRaw`SELECT id FROM refunds WHERE id = ${refundId}::uuid FOR UPDATE`;
    const refund = await tx.refund.findUnique({ where: { id: refundId } });
    if (!refund) throw Errors.notFound('Refund');
    return refund;
  }
}

const busy = () =>
  new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.CONFLICT,
    'This refund is being processed. Please try again in a minute.',
  );

const providerMessage = (error: unknown): string =>
  error instanceof PaymentProviderError || error instanceof AppException
    ? error.message
    : 'Unexpected error';

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
import { AuditService } from '../audit/audit.service';
import { LedgerService } from './ledger.service';
import { PaymentProviderError } from './providers/payment-provider';
import { PaymentProviders } from './providers/payment-providers.service';

type Tx = Prisma.TransactionClient;

/**
 * Refunds (spec §30). One refund per payment — enforced by a unique key — so
 * money can never be returned twice. Phase 3 refunds are always full.
 *
 *   REQUESTED ─approve─▶ PROCESSING ─provider confirms─▶ COMPLETED
 *       │                    └─provider fails─▶ FAILED ─approve again─▶ PROCESSING
 *       └─reject─▶ REJECTED
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: PaymentProviders,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
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

  /** Admin decision. Approving sends the refund to the provider. */
  async review(
    actorId: string,
    refundId: string,
    input: ReviewRefundInput,
    meta: RequestMeta,
  ): Promise<Refund> {
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
      return updated;
    });
    if (refund.status !== RefundStatus.PROCESSING) return refund;
    return this.sendToProvider(refund, actorId, meta);
  }

  private async sendToProvider(
    refund: Refund,
    actorId: string,
    meta: RequestMeta,
  ): Promise<Refund> {
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: refund.paymentId },
    });
    let result: Awaited<ReturnType<ReturnType<PaymentProviders['get']>['refund']>>;
    try {
      result = await this.providers
        .get(payment.provider)
        .refund({ reference: payment.reference, amountKobo: refund.amountKobo });
    } catch (error) {
      const message =
        error instanceof PaymentProviderError || error instanceof AppException
          ? error.message
          : 'Unexpected error';
      this.logger.error(`Refund ${refund.id} failed at provider: ${message}`);
      return this.fail(refund.id, message.slice(0, 300), actorId, meta);
    }
    if (result.status === 'failed') {
      return this.fail(
        refund.id,
        result.message ?? 'Refused by the payment provider',
        actorId,
        meta,
      );
    }
    const withId = await this.prisma.refund.update({
      where: { id: refund.id },
      data: { providerRefundId: result.providerRefundId },
    });
    return result.status === 'completed' ? this.complete(refund.id, actorId, meta) : withId;
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

  private async lock(tx: Tx, refundId: string): Promise<Refund> {
    await tx.$queryRaw`SELECT id FROM refunds WHERE id = ${refundId}::uuid FOR UPDATE`;
    const refund = await tx.refund.findUnique({ where: { id: refundId } });
    if (!refund) throw Errors.notFound('Refund');
    return refund;
  }
}

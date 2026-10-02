import { Injectable } from '@nestjs/common';
import { LedgerEntryType as L, type LedgerEntryType } from '@havenhub/shared';

import type { Booking, Payment, Prisma } from '../../generated/prisma/client';

type Tx = Prisma.TransactionClient;

type BookingAmounts = Pick<
  Booking,
  | 'id'
  | 'stayKobo'
  | 'cleaningKobo'
  | 'cautionKobo'
  | 'serviceFeeKobo'
  | 'vatKobo'
  | 'totalKobo'
  | 'agentCommissionKobo'
>;

/**
 * Writes the immutable financial ledger. Entries are append-only (enforced by
 * a database trigger) and unique per (source, type), so replaying a webhook or
 * a refund can never record money twice: the second insert is skipped.
 *
 * Invariants:
 *   Σ entries of a payment = payment amount
 *   Σ entries of a refund  = −refund amount (exact negations of the payment's)
 */
@Injectable()
export class LedgerService {
  /** Allocates a payment that confirmed `booking` across its recipients. */
  async recordBookingPayment(tx: Tx, payment: Payment, booking: BookingAmounts): Promise<void> {
    if (payment.amountKobo !== booking.totalKobo) {
      throw new Error('Payment amount does not match the booking total');
    }
    const allocation: [LedgerEntryType, bigint][] = [
      [L.PLATFORM_SERVICE_FEE, booking.serviceFeeKobo],
      [L.PLATFORM_COMMISSION, booking.agentCommissionKobo],
      [L.VAT_PAYABLE, booking.vatKobo],
      [L.AGENT_RENT_PAYABLE, booking.stayKobo - booking.agentCommissionKobo],
      [L.AGENT_CLEANING_PAYABLE, booking.cleaningKobo],
      [L.CAUTION_HELD, booking.cautionKobo],
    ];
    await this.write(
      tx,
      `payment:${payment.id}`,
      booking.id,
      payment.id,
      null,
      allocation,
      payment.amountKobo,
    );
  }

  /** A payment that could not be applied to its booking: all of it is owed back. */
  async recordUnallocatedPayment(tx: Tx, payment: Payment): Promise<void> {
    await this.write(
      tx,
      `payment:${payment.id}`,
      payment.bookingId,
      payment.id,
      null,
      [[L.UNALLOCATED, payment.amountKobo]],
      payment.amountKobo,
    );
  }

  /** Reverses every entry of the refunded payment (full refunds only in Phase 3). */
  async recordRefund(
    tx: Tx,
    refund: { id: string; amountKobo: bigint },
    payment: Payment,
  ): Promise<void> {
    const original = await tx.ledgerEntry.findMany({
      where: { sourceKey: `payment:${payment.id}` },
    });
    const allocation = original.map((e): [LedgerEntryType, bigint] => [e.type, -e.amountKobo]);
    await this.write(
      tx,
      `refund:${refund.id}`,
      payment.bookingId,
      payment.id,
      refund.id,
      allocation,
      -refund.amountKobo,
    );
  }

  private async write(
    tx: Tx,
    sourceKey: string,
    bookingId: string,
    paymentId: string,
    refundId: string | null,
    allocation: [LedgerEntryType, bigint][],
    expectedSum: bigint,
  ): Promise<void> {
    const entries = allocation.filter(([, amount]) => amount !== 0n);
    const sum = entries.reduce((s, [, amount]) => s + amount, 0n);
    if (sum !== expectedSum) {
      throw new Error(
        `Ledger allocation for ${sourceKey} does not balance (${sum} ≠ ${expectedSum})`,
      );
    }
    await tx.ledgerEntry.createMany({
      data: entries.map(([type, amountKobo]) => ({
        sourceKey,
        type,
        amountKobo,
        bookingId,
        paymentId,
        refundId,
      })),
      skipDuplicates: true,
    });
  }
}

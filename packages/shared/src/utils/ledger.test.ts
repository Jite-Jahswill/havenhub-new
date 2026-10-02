import { describe, expect, it } from 'vitest';

import { LedgerEntryType } from '../enums/booking.js';
import { LEDGER_ENTRY_BUCKET, LedgerBucket, summarizeLedger } from './ledger.js';

const payment = [
  { type: LedgerEntryType.PLATFORM_SERVICE_FEE, amountKobo: 1_500_000, refundId: null },
  { type: LedgerEntryType.PLATFORM_COMMISSION, amountKobo: 750_000, refundId: null },
  { type: LedgerEntryType.VAT_PAYABLE, amountKobo: 112_500, refundId: null },
  { type: LedgerEntryType.AGENT_RENT_PAYABLE, amountKobo: 14_250_000, refundId: null },
  { type: LedgerEntryType.AGENT_CLEANING_PAYABLE, amountKobo: 1_000_000, refundId: null },
  { type: LedgerEntryType.CAUTION_HELD, amountKobo: 2_000_000, refundId: null },
];
const paid = payment.reduce((s, e) => s + e.amountKobo, 0);

describe('ledger buckets', () => {
  it('classifies every entry type', () => {
    for (const type of Object.values(LedgerEntryType)) {
      expect(Object.values(LedgerBucket)).toContain(LEDGER_ENTRY_BUCKET[type]);
    }
  });

  it('the caution deposit is held, never revenue or agent money', () => {
    expect(LEDGER_ENTRY_BUCKET.CAUTION_HELD).toBe(LedgerBucket.CAUTION_HELD);
    const s = summarizeLedger(payment);
    expect(s.cautionHeldKobo).toBe(2_000_000);
    expect(s.revenueKobo).toBe(1_500_000 + 750_000);
    expect(s.agentPayableKobo).toBe(14_250_000 + 1_000_000);
    expect(s.taxPayableKobo).toBe(112_500);
  });

  it('separates the customer payment from what HavenHub, the agent and the government are owed', () => {
    const s = summarizeLedger(payment);
    expect(s.customerPaidKobo).toBe(paid);
    expect(s.customerRefundedKobo).toBe(0);
    expect(s.revenueKobo + s.taxPayableKobo + s.agentPayableKobo + s.cautionHeldKobo).toBe(
      s.customerPaidKobo,
    );
  });

  it('a full refund nets every bucket to zero', () => {
    const refund = payment.map((e) => ({ ...e, amountKobo: -e.amountKobo, refundId: 'r1' }));
    const s = summarizeLedger([...payment, ...refund]);
    expect(s).toEqual({
      customerPaidKobo: paid,
      customerRefundedKobo: paid,
      revenueKobo: 0,
      taxPayableKobo: 0,
      agentPayableKobo: 0,
      cautionHeldKobo: 0,
      owedToCustomerKobo: 0,
    });
  });

  it('unallocated money is owed back to the customer, not revenue', () => {
    const s = summarizeLedger([
      { type: LedgerEntryType.UNALLOCATED, amountKobo: 500_000, refundId: null },
    ]);
    expect(s).toMatchObject({
      customerPaidKobo: 500_000,
      owedToCustomerKobo: 500_000,
      revenueKobo: 0,
    });
  });
});

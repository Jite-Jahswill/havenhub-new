import { LedgerEntryType } from '../enums/booking.js';

/**
 * What each ledger entry *is* to HavenHub. A customer payment is never all
 * revenue: only the service fee and commission are. VAT is owed to the
 * government, the agent's share is owed to the agent, and the caution
 * deposit is the customer's money held in trust (its release policy is not
 * defined yet) — it is never revenue.
 */
export const LedgerBucket = {
  /** HavenHub's own income: service fee + commission. */
  REVENUE: 'REVENUE',
  /** VAT collected, owed to the tax authority. */
  TAX_PAYABLE: 'TAX_PAYABLE',
  /** Owed to the agent: rent after commission + cleaning. */
  AGENT_PAYABLE: 'AGENT_PAYABLE',
  /** Refundable caution deposit held on the customer's behalf. */
  CAUTION_HELD: 'CAUTION_HELD',
  /** Money that could not be applied to a booking; owed back to the customer. */
  OWED_TO_CUSTOMER: 'OWED_TO_CUSTOMER',
} as const;
export type LedgerBucket = (typeof LedgerBucket)[keyof typeof LedgerBucket];

export const LEDGER_ENTRY_BUCKET: Record<LedgerEntryType, LedgerBucket> = {
  [LedgerEntryType.PLATFORM_SERVICE_FEE]: LedgerBucket.REVENUE,
  [LedgerEntryType.PLATFORM_COMMISSION]: LedgerBucket.REVENUE,
  [LedgerEntryType.VAT_PAYABLE]: LedgerBucket.TAX_PAYABLE,
  [LedgerEntryType.AGENT_RENT_PAYABLE]: LedgerBucket.AGENT_PAYABLE,
  [LedgerEntryType.AGENT_CLEANING_PAYABLE]: LedgerBucket.AGENT_PAYABLE,
  [LedgerEntryType.CAUTION_HELD]: LedgerBucket.CAUTION_HELD,
  [LedgerEntryType.UNALLOCATED]: LedgerBucket.OWED_TO_CUSTOMER,
};

/**
 * Net position of a booking's ledger (kobo). Always balances:
 *   customerPaid − customerRefunded
 *     = revenue + taxPayable + agentPayable + cautionHeld + owedToCustomer
 */
export interface LedgerSummary {
  /** Everything the customer paid (sum of payment entries). */
  customerPaidKobo: number;
  /** Everything returned to the customer (sum of refund entries, positive). */
  customerRefundedKobo: number;
  revenueKobo: number;
  taxPayableKobo: number;
  agentPayableKobo: number;
  cautionHeldKobo: number;
  owedToCustomerKobo: number;
}

export function summarizeLedger(
  entries: readonly { type: LedgerEntryType; amountKobo: number; refundId: string | null }[],
): LedgerSummary {
  const summary: LedgerSummary = {
    customerPaidKobo: 0,
    customerRefundedKobo: 0,
    revenueKobo: 0,
    taxPayableKobo: 0,
    agentPayableKobo: 0,
    cautionHeldKobo: 0,
    owedToCustomerKobo: 0,
  };
  const field = {
    REVENUE: 'revenueKobo',
    TAX_PAYABLE: 'taxPayableKobo',
    AGENT_PAYABLE: 'agentPayableKobo',
    CAUTION_HELD: 'cautionHeldKobo',
    OWED_TO_CUSTOMER: 'owedToCustomerKobo',
  } as const satisfies Record<LedgerBucket, keyof LedgerSummary>;
  for (const e of entries) {
    if (e.refundId) summary.customerRefundedKobo -= e.amountKobo;
    else summary.customerPaidKobo += e.amountKobo;
    summary[field[LEDGER_ENTRY_BUCKET[e.type]]] += e.amountKobo;
  }
  return summary;
}

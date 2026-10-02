import type { LedgerEntryView, PaymentView, RefundView } from '@havenhub/shared';

import { koboToNumber } from '../../common/money';
import type { LedgerEntry, Payment, Refund } from '../../generated/prisma/client';

export const toPaymentView = (p: Payment): PaymentView => ({
  id: p.id,
  reference: p.reference,
  provider: p.provider,
  status: p.status,
  amountKobo: koboToNumber(p.amountKobo),
  currency: p.currency,
  failureReason: p.failureReason,
  paidAt: p.paidAt?.toISOString() ?? null,
  createdAt: p.createdAt.toISOString(),
});

export const toRefundView = (r: Refund): RefundView => ({
  id: r.id,
  status: r.status,
  amountKobo: koboToNumber(r.amountKobo),
  reason: r.reason,
  reviewNote: r.reviewNote,
  requestedBy: r.requestedBy,
  createdAt: r.createdAt.toISOString(),
  completedAt: r.completedAt?.toISOString() ?? null,
});

export const toLedgerEntryView = (e: LedgerEntry): LedgerEntryView => ({
  id: e.id,
  type: e.type,
  amountKobo: koboToNumber(e.amountKobo),
  paymentId: e.paymentId,
  refundId: e.refundId,
  createdAt: e.createdAt.toISOString(),
});

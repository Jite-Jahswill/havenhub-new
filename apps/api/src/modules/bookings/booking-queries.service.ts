import { Injectable } from '@nestjs/common';
import {
  AgentEarningStatus,
  BookingStatus,
  LedgerEntryType,
  summarizeLedger,
  type AdminBookingDetail,
  type AdminBookingListItem,
  type AgentBookingDetail,
  type AgentBookingListItem,
  type AgentEarningsSummary,
  type BookingSummary,
  type CustomerBookingDetail,
  type Paginated,
  type Permission,
  type adminListBookingsQuerySchema,
  type listBookingsQuerySchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
import { paginate } from '../../common/http/response';
import { koboToNumber } from '../../common/money';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { toLedgerEntryView, toPaymentView, toRefundView } from '../finance/finance.mapper';
import {
  BOOKING_DETAIL_INCLUDE,
  BOOKING_SUMMARY_INCLUDE,
  cancelDecisionFor,
  snapshotOf,
  toCancellation,
  toPriceLine,
  toSnapshotView,
  toSummary,
  type BookingDetailRow,
  type BookingSummaryRow,
} from './booking.mapper';
import { PlatformPoliciesService } from '../platform/platform-policies.service';
import { ReviewsService } from '../reviews/reviews.service';

type ListQuery = z.output<typeof listBookingsQuerySchema>;

/**
 * Read models. Every query is scoped by who is asking: customers by their
 * own id, agents by their own profile, admins by permission. A booking
 * outside the caller's scope is "not found", never "forbidden".
 */
@Injectable()
export class BookingQueriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly policies: PlatformPoliciesService,
    private readonly reviews: ReviewsService,
  ) {}

  // ── Customer ─────────────────────────────────────────────────────────────

  async customerList(customerId: string, query: ListQuery): Promise<Paginated<BookingSummary>> {
    const { rows, total } = await this.page({ customerId, ...statusFilter(query) }, query);
    return paginate(
      rows.map((r) => toSummary(r, this.storage)),
      query.page,
      query.pageSize,
      total,
    );
  }

  async customerDetail(customerId: string, bookingId: string): Promise<CustomerBookingDetail> {
    const row = await this.prisma.booking.findFirst({
      where: { id: bookingId, customerId },
      include: BOOKING_DETAIL_INCLUDE,
    });
    if (!row) throw Errors.notFound('Booking');
    const cutoff = (await this.policies.get()).refunds.customerCancelCutoffDays;
    const decision = cancelDecisionFor(row, 'CUSTOMER', cutoff);
    const latestRefund = row.refunds.at(-1);
    return {
      ...toSummary(row, this.storage),
      ...(await this.reviews.stateFor(row)),
      snapshot: toSnapshotView(row, this.storage),
      guests: row.guests,
      cleaningSelected: row.cleaningSelected,
      lines: row.lines.map(toPriceLine),
      refundableDepositKobo: koboToNumber(row.cautionKobo),
      agent: { id: row.agentProfileId, displayName: snapshotOf(row).agentDisplayName },
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      cancellation: toCancellation(row),
      payments: row.payments.map(toPaymentView),
      refund: latestRefund ? toRefundView(latestRefund) : null,
      canPay:
        row.status === BookingStatus.AWAITING_PAYMENT &&
        !!row.holdExpiresAt &&
        row.holdExpiresAt > new Date(),
      canCancel: decision.allowed,
      cancellationRefundKobo: decision.refund === 'FULL' ? koboToNumber(row.totalKobo) : 0,
    };
  }

  // ── Agent ────────────────────────────────────────────────────────────────

  async agentList(
    agentProfileId: string,
    query: ListQuery,
  ): Promise<Paginated<AgentBookingListItem>> {
    const { rows, total } = await this.page({ agentProfileId, ...statusFilter(query) }, query);
    return paginate(
      rows.map((r) => this.agentItem(r)),
      query.page,
      query.pageSize,
      total,
    );
  }

  async agentDetail(agentProfileId: string, bookingId: string): Promise<AgentBookingDetail> {
    const row = await this.prisma.booking.findFirst({
      where: { id: bookingId, agentProfileId },
      include: BOOKING_DETAIL_INCLUDE,
    });
    if (!row) throw Errors.notFound('Booking');
    // Contact details only once the customer has actually paid.
    const shareContact =
      row.status === BookingStatus.CONFIRMED || row.status === BookingStatus.COMPLETED;
    const latestRefund = row.refunds.at(-1);
    return {
      ...this.agentItem(row),
      snapshot: toSnapshotView(row, this.storage),
      guests: row.guests,
      cleaningSelected: row.cleaningSelected,
      customer: {
        fullName: row.customer.fullName,
        email: shareContact ? row.customer.email : null,
        phone: shareContact ? row.customer.phone : null,
      },
      lines: row.lines.map(toPriceLine),
      financials: {
        stayKobo: koboToNumber(row.stayKobo),
        cleaningKobo: koboToNumber(row.cleaningKobo),
        commissionKobo: koboToNumber(row.agentCommissionKobo),
        payoutKobo: koboToNumber(row.agentPayoutKobo),
        vatKobo: koboToNumber(row.vatKobo),
        cautionKobo: koboToNumber(row.cautionKobo),
        earningStatus: row.earning?.status ?? null,
      },
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      cancellation: toCancellation(row),
      refund: latestRefund ? toRefundView(latestRefund) : null,
      // The refunds policy's cut-off applies to customers only.
      canCancel: cancelDecisionFor(row, 'AGENT', 0).allowed,
    };
  }

  /** Earnings come from the agent_earnings records and the immutable ledger. */
  async agentEarnings(agentProfileId: string): Promise<AgentEarningsSummary> {
    const [byStatus, ledger, paidBookings] = await Promise.all([
      this.prisma.agentEarning.groupBy({
        by: ['status'],
        where: { agentProfileId },
        _sum: { amountKobo: true },
      }),
      this.prisma.ledgerEntry.groupBy({
        by: ['type'],
        where: {
          booking: { agentProfileId },
          refundId: null,
          type: {
            in: [
              LedgerEntryType.AGENT_RENT_PAYABLE,
              LedgerEntryType.AGENT_CLEANING_PAYABLE,
              LedgerEntryType.PLATFORM_COMMISSION,
              LedgerEntryType.VAT_PAYABLE,
            ],
          },
        },
        _sum: { amountKobo: true },
      }),
      this.prisma.agentEarning.count({ where: { agentProfileId } }),
    ]);
    const earning = (status: AgentEarningStatus) =>
      koboToNumber(byStatus.find((r) => r.status === status)?._sum.amountKobo ?? 0n);
    const captured = (type: LedgerEntryType) =>
      ledger.find((r) => r.type === type)?._sum.amountKobo ?? 0n;
    const commission = captured(LedgerEntryType.PLATFORM_COMMISSION);
    return {
      paidBookings,
      grossKobo: koboToNumber(
        captured(LedgerEntryType.AGENT_RENT_PAYABLE) +
          captured(LedgerEntryType.AGENT_CLEANING_PAYABLE) +
          commission,
      ),
      commissionKobo: koboToNumber(commission),
      pendingKobo: earning(AgentEarningStatus.PENDING),
      availableKobo: earning(AgentEarningStatus.AVAILABLE),
      reversedKobo: earning(AgentEarningStatus.REVERSED),
      vatKobo: koboToNumber(captured(LedgerEntryType.VAT_PAYABLE)),
      withdrawalsAvailable: false,
    };
  }

  private agentItem(row: BookingSummaryRow | BookingDetailRow): AgentBookingListItem {
    return {
      ...toSummary(row, this.storage),
      customerName: row.customer.fullName,
      payoutKobo: koboToNumber(row.agentPayoutKobo),
      earningStatus: row.earning?.status ?? null,
    };
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  async adminList(
    query: z.output<typeof adminListBookingsQuerySchema>,
  ): Promise<Paginated<AdminBookingListItem>> {
    const where: Prisma.BookingWhereInput = {
      ...statusFilter(query),
      ...(query.search
        ? {
            OR: [
              { reference: { contains: query.search.toUpperCase() } },
              { customer: { email: { contains: query.search, mode: 'insensitive' } } },
              { customer: { fullName: { contains: query.search, mode: 'insensitive' } } },
              { property: { title: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const { rows, total } = await this.page(where, query);
    return paginate(
      rows.map((r) => this.adminItem(r)),
      query.page,
      query.pageSize,
      total,
    );
  }

  /** Payment, refund and ledger detail is included only for `payments.view`. */
  async adminDetail(
    bookingId: string,
    permissions: ReadonlySet<Permission>,
  ): Promise<AdminBookingDetail> {
    const row = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { ...BOOKING_DETAIL_INCLUDE, ledgerEntries: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) throw Errors.notFound('Booking');
    const finance = permissions.has('payments.view');
    const ledger = row.ledgerEntries.map(toLedgerEntryView);
    return {
      ...this.adminItem(row),
      snapshot: toSnapshotView(row, this.storage),
      guests: row.guests,
      cleaningSelected: row.cleaningSelected,
      lines: row.lines.map(toPriceLine),
      financials: {
        serviceFeeKobo: koboToNumber(row.serviceFeeKobo),
        agentCommissionKobo: koboToNumber(row.agentCommissionKobo),
        vatKobo: koboToNumber(row.vatKobo),
        cautionKobo: koboToNumber(row.cautionKobo),
        agentPayoutKobo: koboToNumber(row.agentPayoutKobo),
        pricingConfigVersion: row.pricingConfig.version,
      },
      earningStatus: row.earning?.status ?? null,
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      cancellation: toCancellation(row),
      payments: finance ? row.payments.map(toPaymentView) : [],
      refunds: finance ? row.refunds.map(toRefundView) : [],
      ledger: finance ? ledger : [],
      ledgerSummary: finance ? summarizeLedger(ledger) : null,
      canCancel: cancelDecisionFor(row, 'ADMIN', 0).allowed,
    };
  }

  private adminItem(row: BookingSummaryRow | BookingDetailRow): AdminBookingListItem {
    return {
      ...toSummary(row, this.storage),
      customer: { id: row.customer.id, fullName: row.customer.fullName, email: row.customer.email },
      agent: { id: row.agentProfileId, displayName: snapshotOf(row).agentDisplayName },
    };
  }

  private async page(where: Prisma.BookingWhereInput, query: ListQuery) {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.booking.count({ where }),
      this.prisma.booking.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: BOOKING_SUMMARY_INCLUDE,
      }),
    ]);
    return { rows, total };
  }
}

const statusFilter = (query: ListQuery): Prisma.BookingWhereInput =>
  query.status ? { status: query.status } : {};

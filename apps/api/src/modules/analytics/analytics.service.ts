import { Injectable } from '@nestjs/common';
import {
  addDays,
  todayInNigeria,
  type AgentAnalytics,
  type AnalyticsRange,
  type FinancialAnalytics,
  type Metric,
  type ModeratedListingType,
  type PlatformAnalytics,
  type analyticsQuerySchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { watDayStart } from '../audit/audit.service';

type Query = z.output<typeof analyticsQuerySchema>;

/** Payments that succeeded (a later refund does not undo the sale: revenue is before refunds). */
const PAID = ['SUCCESS', 'REFUNDED'] as const;

const value = (n: number | bigint | null | undefined): Metric => ({
  available: true,
  value: Number(n ?? 0),
});
const unavailable = (reason: string): Metric => ({ available: false, reason });

const NO_TICKETING = 'Ticket sales are not available yet';
const NO_SALES = 'Property sales happen directly with agents, outside HavenHub';
const NO_REVIEWS = 'Reviews are not available yet';
const NO_WITHDRAWALS = 'Withdrawals are not available yet';

interface Window {
  range: AnalyticsRange;
  /** [start, end) instants for the inclusive WAT calendar range. */
  start: Date;
  end: Date;
}

/**
 * Read-only analytics computed live from existing records (no rollups).
 * Calendar dates are Nigerian (WAT); all money is integer kobo.
 *
 * Definitions:
 *  - Active user (approximate): has a session signed in before the period
 *    ended and last used at or after it began. Sessions keep only their
 *    sign-in and most recent use, not every request, so a session used
 *    both before and after the period (but not during it) is still counted.
 *  - Revenue: gross value of successful booking payments, recognised on the
 *    payment date, before refunds. Refunds, commission, service fees, VAT
 *    and subscription revenue are separate figures.
 *  - Agent conversion: confirmed bookings ÷ property views in the period.
 *  - Features that do not exist yet report "not available", never zero.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async platform(query: Query): Promise<PlatformAnalytics> {
    const { range, start, end } = window(query);
    const [
      usersTotal,
      usersNew,
      [active],
      agentsTotal,
      agentsVerified,
      properties,
      experiences,
      bookingsConfirmed,
    ] = await Promise.all([
      this.prisma.user.count({ where: { createdAt: { lt: end } } }),
      this.prisma.user.count({ where: { createdAt: { gte: start, lt: end } } }),
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(DISTINCT user_id) AS count FROM sessions
        WHERE created_at < ${end} AND last_used_at >= ${start}`,
      this.prisma.agentProfile.count({ where: { createdAt: { lt: end } } }),
      this.prisma.agentProfile.count({
        where: { createdAt: { lt: end }, verificationStatus: 'VERIFIED' },
      }),
      this.prisma.property.count({ where: { status: 'PUBLISHED' } }),
      this.prisma.experience.groupBy({
        by: ['kind'],
        where: { status: 'PUBLISHED' },
        _count: { _all: true },
      }),
      this.prisma.booking.count({ where: { confirmedAt: { gte: start, lt: end } } }),
    ]);
    const live = (kind: Exclude<ModeratedListingType, 'PROPERTY'>) =>
      value(experiences.find((e) => e.kind === kind)?._count._all ?? 0);
    return {
      range,
      users: { total: value(usersTotal), new: value(usersNew), active: value(active?.count) },
      agents: { total: value(agentsTotal), verified: value(agentsVerified) },
      listings: {
        PROPERTY: value(properties),
        EVENT: live('EVENT'),
        TOUR: live('TOUR'),
        HOTEL: live('HOTEL'),
        CLEANING: live('CLEANING'),
      },
      bookings: { confirmed: value(bookingsConfirmed) },
      sales: unavailable(NO_SALES),
      eventTicketSales: unavailable(NO_TICKETING),
      reviews: unavailable(NO_REVIEWS),
    };
  }

  async financial(query: Query): Promise<FinancialAnalytics> {
    const { range, start, end } = window(query);
    const paidInRange = { status: { in: [...PAID] }, paidAt: { gte: start, lt: end } };
    const [payments, refunds, ledger, subscriptions] = await Promise.all([
      this.prisma.payment.aggregate({
        where: paidInRange,
        _sum: { amountKobo: true },
        _count: { _all: true },
      }),
      this.prisma.refund.aggregate({
        where: { status: 'COMPLETED', completedAt: { gte: start, lt: end } },
        _sum: { amountKobo: true },
        _count: { _all: true },
      }),
      // Allocations written when each payment was captured (refund reversals are excluded:
      // refunds are reported on their own).
      this.prisma.ledgerEntry.groupBy({
        by: ['type'],
        where: {
          type: { in: ['PLATFORM_COMMISSION', 'PLATFORM_SERVICE_FEE', 'VAT_PAYABLE'] },
          refundId: null,
          payment: paidInRange,
        },
        _sum: { amountKobo: true },
      }),
      this.prisma.subscriptionPayment.aggregate({ where: paidInRange, _sum: { amountKobo: true } }),
    ]);
    const ledgerSum = (type: string) => value(ledger.find((l) => l.type === type)?._sum.amountKobo);
    return {
      range,
      revenueKobo: value(payments._sum.amountKobo),
      successfulPayments: value(payments._count._all),
      refundsKobo: value(refunds._sum.amountKobo),
      refunds: value(refunds._count._all),
      commissionKobo: ledgerSum('PLATFORM_COMMISSION'),
      serviceFeeKobo: ledgerSum('PLATFORM_SERVICE_FEE'),
      vatKobo: ledgerSum('VAT_PAYABLE'),
      subscriptionRevenueKobo: value(subscriptions._sum.amountKobo),
      withdrawalsKobo: unavailable(NO_WITHDRAWALS),
      eventTicketSalesKobo: unavailable(NO_TICKETING),
    };
  }

  /** Every figure is scoped to the signed-in agent's own profile — never an id from the client. */
  async agent(userId: string, query: Query): Promise<AgentAnalytics> {
    const profile = await this.prisma.agentProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) throw Errors.notFound('Agent profile');
    const agentProfileId = profile.id;
    const { range, start, end } = window(query);
    const paidInRange = {
      status: { in: [...PAID] },
      paidAt: { gte: start, lt: end },
      booking: { agentProfileId },
    };
    const [views, bookings, revenue, [earnings]] = await Promise.all([
      this.prisma.propertyViewDaily.aggregate({
        where: {
          property: { agentProfileId },
          day: { gte: new Date(`${range.from}T00:00:00Z`), lte: new Date(`${range.to}T00:00:00Z`) },
        },
        _sum: { views: true },
      }),
      this.prisma.booking.count({
        where: { agentProfileId, confirmedAt: { gte: start, lt: end } },
      }),
      this.prisma.payment.aggregate({ where: paidInRange, _sum: { amountKobo: true } }),
      this.prisma.$queryRaw<{ total: bigint | null }[]>`
        SELECT SUM(e.amount_kobo) AS total FROM agent_earnings e
        WHERE e.agent_profile_id = ${agentProfileId}::uuid
          AND EXISTS (
            SELECT 1 FROM payments p
            WHERE p.booking_id = e.booking_id AND p.status IN ('SUCCESS', 'REFUNDED')
              AND p.paid_at >= ${start} AND p.paid_at < ${end})`,
    ]);
    const viewCount = views._sum.views ?? 0;
    return {
      range,
      propertyViews: value(viewCount),
      bookings: value(bookings),
      conversion: viewCount
        ? value(bookings / viewCount)
        : unavailable('No property views in this period'),
      revenueKobo: value(revenue._sum.amountKobo),
      earningsKobo: value(earnings?.total),
      reviews: unavailable(NO_REVIEWS),
      eventSalesKobo: unavailable(NO_TICKETING),
    };
  }
}

/** Defaults to the 30 days ending today (Nigerian time). */
function window(query: Query): Window {
  const to = query.to ?? todayInNigeria();
  const from = query.from ?? addDays(to, -29);
  return { range: { from, to }, start: watDayStart(from), end: watDayStart(addDays(to, 1)) };
}

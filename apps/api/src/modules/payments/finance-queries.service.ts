import { Injectable } from '@nestjs/common';
import type {
  AdminPaymentListItem,
  AdminRefundListItem,
  Paginated,
  adminListPaymentsQuerySchema,
  adminListRefundsQuerySchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { paginate } from '../../common/http/response';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { toPaymentView, toRefundView } from '../finance/finance.mapper';

const customer = { select: { id: true, fullName: true, email: true } } as const;

@Injectable()
export class FinanceQueriesService {
  constructor(private readonly prisma: PrismaService) {}

  async payments(
    query: z.output<typeof adminListPaymentsQuerySchema>,
  ): Promise<Paginated<AdminPaymentListItem>> {
    const where = query.status ? { status: query.status } : {};
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { booking: { select: { id: true, reference: true, status: true, customer } } },
      }),
    ]);
    return paginate(
      rows.map((p) => ({
        ...toPaymentView(p),
        booking: { id: p.booking.id, reference: p.booking.reference, status: p.booking.status },
        customer: p.booking.customer,
      })),
      query.page,
      query.pageSize,
      total,
    );
  }

  async refunds(
    query: z.output<typeof adminListRefundsQuerySchema>,
  ): Promise<Paginated<AdminRefundListItem>> {
    const where = query.status ? { status: query.status } : {};
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.refund.count({ where }),
      this.prisma.refund.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          booking: { select: { id: true, reference: true, customer } },
          payment: { select: { reference: true, provider: true } },
        },
      }),
    ]);
    return paginate(
      rows.map((r) => ({
        ...toRefundView(r),
        booking: { id: r.booking.id, reference: r.booking.reference },
        customer: r.booking.customer,
        payment: r.payment,
      })),
      query.page,
      query.pageSize,
      total,
    );
  }
}

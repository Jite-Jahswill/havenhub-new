import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode, type PricingConfigInput, type PricingConfigView } from '@havenhub/shared';

import { AppException } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import type { PricingConfig } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Admin-configured commission, VAT and fee rates (spec §29). There are no
 * built-in percentages: until an administrator saves a configuration,
 * bookings are closed. Each save is a new immutable version.
 *
 * Production rates have NOT been approved. The 10% fee / 5% commission /
 * 7.5% VAT used in tests and local QA (`test/fixtures/qa-pricing-rates.ts`)
 * are development values only — never add them here as a default.
 */
@Injectable()
export class PricingConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  current(): Promise<PricingConfig | null> {
    return this.prisma.pricingConfig.findFirst({ orderBy: { version: 'desc' } });
  }

  /** The active configuration, or "bookings are not open yet". */
  async require(): Promise<PricingConfig> {
    const config = await this.current();
    if (!config) {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.BOOKINGS_NOT_OPEN,
        'Online booking is not open yet. Please check back soon.',
      );
    }
    return config;
  }

  async history(): Promise<PricingConfigView[]> {
    const rows = await this.prisma.pricingConfig.findMany({
      orderBy: { version: 'desc' },
      take: 20,
      include: { createdBy: { select: { id: true, fullName: true } } },
    });
    return rows.map(toView);
  }

  async create(
    actorId: string,
    input: PricingConfigInput,
    meta: RequestMeta,
  ): Promise<PricingConfigView> {
    const row = await this.prisma.$transaction(async (tx) => {
      // Serialise version numbers.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pricing_configs'))`;
      const latest = await tx.pricingConfig.findFirst({ orderBy: { version: 'desc' } });
      const created = await tx.pricingConfig.create({
        data: {
          version: (latest?.version ?? 0) + 1,
          serviceFeeBps: input.serviceFeeBps,
          agentCommissionBps: input.agentCommissionBps,
          vatBps: input.vatBps,
          vatOnServiceFee: input.vatOnServiceFee,
          vatOnStay: input.vatOnStay,
          note: input.note ?? null,
          createdById: actorId,
        },
        include: { createdBy: { select: { id: true, fullName: true } } },
      });
      await this.audit.record(
        {
          actorId,
          action: 'finance.pricing_config.created',
          resourceType: 'pricing_config',
          resourceId: created.id,
          before: latest ? rates(latest) : undefined,
          after: { version: created.version, ...rates(created) },
          meta,
        },
        tx,
      );
      return created;
    });
    return toView(row);
  }
}

const rates = (c: PricingConfig) => ({
  serviceFeeBps: c.serviceFeeBps,
  agentCommissionBps: c.agentCommissionBps,
  vatBps: c.vatBps,
  vatOnServiceFee: c.vatOnServiceFee,
  vatOnStay: c.vatOnStay,
});

function toView(
  c: PricingConfig & { createdBy: { id: string; fullName: string } | null },
): PricingConfigView {
  return {
    version: c.version,
    ...rates(c),
    note: c.note,
    createdAt: c.createdAt.toISOString(),
    createdBy: c.createdBy,
  };
}

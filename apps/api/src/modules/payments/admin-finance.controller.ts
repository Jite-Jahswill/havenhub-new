import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  AccountType,
  adminListPaymentsQuerySchema,
  adminListRefundsQuerySchema,
  pricingConfigSchema,
  reviewRefundSchema,
} from '@havenhub/shared';
import type { Request } from 'express';
import type { z } from 'zod';

import { requestMeta } from '../../common/http/request-meta';
import { ok } from '../../common/http/response';
import { validate } from '../../common/pipes/zod-validation.pipe';
import type { AuthContext } from '../auth/auth.types';
import {
  AccountTypes,
  CurrentAuth,
  RequirePermissions,
  RequireVerifiedEmail,
} from '../auth/decorators/auth.decorators';
import { toRefundView } from '../finance/finance.mapper';
import { PricingConfigService } from '../finance/pricing-config.service';
import { RefundsService } from '../finance/refunds.service';
import { FinanceQueriesService } from './finance-queries.service';

/** Minimum Phase 3 finance surface: payments, refunds and rate configuration. */
@Controller('admin')
@AccountTypes(AccountType.ADMIN)
@RequireVerifiedEmail()
export class AdminFinanceController {
  constructor(
    private readonly queries: FinanceQueriesService,
    private readonly refunds: RefundsService,
    private readonly pricing: PricingConfigService,
  ) {}

  @Get('payments')
  @RequirePermissions('payments.view')
  async payments(
    @Query(validate(adminListPaymentsQuerySchema))
    query: z.output<typeof adminListPaymentsQuerySchema>,
  ) {
    return ok(await this.queries.payments(query));
  }

  @Get('refunds')
  @RequirePermissions('payments.view')
  async refundList(
    @Query(validate(adminListRefundsQuerySchema))
    query: z.output<typeof adminListRefundsQuerySchema>,
  ) {
    return ok(await this.queries.refunds(query));
  }

  /** Approve (sends the money back through the provider) or reject. Audited. */
  @Post('refunds/:id/review')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payments.view', 'payments.refund')
  async review(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(validate(reviewRefundSchema)) body: z.output<typeof reviewRefundSchema>,
    @Req() req: Request,
  ) {
    return ok(toRefundView(await this.refunds.review(auth.user.id, id, body, requestMeta(req))));
  }

  @Get('finance/pricing')
  @RequirePermissions('payments.view')
  async pricingHistory() {
    const history = await this.pricing.history();
    return ok({ current: history[0] ?? null, history });
  }

  /** Saves a new version of the commission/VAT/fee rates. Applies to new bookings only. */
  @Post('finance/pricing')
  @RequirePermissions('payments.view', 'payments.settings')
  async savePricing(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(pricingConfigSchema)) body: z.output<typeof pricingConfigSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.pricing.create(auth.user.id, body, requestMeta(req)));
  }
}

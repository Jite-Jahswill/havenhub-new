import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { AccountType, ErrorCode, testCheckoutSchema } from '@havenhub/shared';
import type { Request } from 'express';
import type { z } from 'zod';

import { AppException, Errors } from '../../common/errors/app.exception';
import { requestMeta } from '../../common/http/request-meta';
import { ok } from '../../common/http/response';
import { validate } from '../../common/pipes/zod-validation.pipe';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import type { AuthContext } from '../auth/auth.types';
import {
  AccountTypes,
  CurrentAuth,
  Public,
  RequireVerifiedEmail,
  SkipCsrf,
} from '../auth/decorators/auth.decorators';
import { MaintenanceExempt } from '../platform/maintenance';
import { InvalidWebhookSignature } from '../finance/providers/payment-provider';
import { PaymentProviders } from '../finance/providers/payment-providers.service';
import { RefundsService } from '../finance/refunds.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PaymentsService } from './payments.service';

const REFERENCE = /^HHP-[0-9a-f]{24}$/;

function validReference(reference: string): string {
  if (!REFERENCE.test(reference)) throw Errors.notFound('Payment');
  return reference;
}

@Controller()
@AccountTypes(AccountType.CUSTOMER)
@RequireVerifiedEmail()
export class CustomerPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('bookings/:id/payments')
  @RateLimit({ name: 'payment-init:user', limit: 30, windowSeconds: 3600, by: 'user' })
  async initiate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    return ok(
      await this.payments.initiate(
        { id: auth.user.id, email: auth.user.email },
        id,
        requestMeta(req),
      ),
    );
  }

  /**
   * Called when the customer returns from checkout. Only the reference is
   * taken from the browser; the outcome comes from the provider.
   */
  @Post('payments/:reference/verify')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'payment-verify:user', limit: 60, windowSeconds: 600, by: 'user' })
  async verify(@CurrentAuth() auth: AuthContext, @Param('reference') reference: string) {
    return ok(await this.payments.verifyForCustomer(auth.user.id, validReference(reference)));
  }

  // ── Development test checkout (404 unless PAYMENT_PROVIDER=test outside production) ──

  @Get('payments/test-checkout/:reference')
  async testCheckout(@CurrentAuth() auth: AuthContext, @Param('reference') reference: string) {
    return ok(await this.payments.testCheckout(auth.user.id, validReference(reference)));
  }

  @Post('payments/test-checkout/:reference')
  @HttpCode(HttpStatus.OK)
  async completeTestCheckout(
    @CurrentAuth() auth: AuthContext,
    @Param('reference') reference: string,
    @Body(validate(testCheckoutSchema)) body: z.output<typeof testCheckoutSchema>,
  ) {
    return ok(
      await this.payments.completeTestCheckout(
        auth.user.id,
        validReference(reference),
        body.outcome,
      ),
    );
  }
}

/**
 * Provider webhooks. Authenticated by signature over the exact raw body; the
 * event only tells us *which* payment to re-verify — its contents are never
 * trusted for amounts or status.
 */
@Public()
@SkipCsrf()
// Payments confirmed during maintenance must still be recorded.
@MaintenanceExempt()
@Controller('payments/webhooks')
export class PaymentWebhooksController {
  private readonly logger = new Logger(PaymentWebhooksController.name);

  constructor(
    private readonly providers: PaymentProviders,
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  @Post('paystack')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'webhook:ip', limit: 600, windowSeconds: 60, by: 'ip' })
  async paystack(@Req() req: RawBodyRequest<Request>) {
    const provider = this.providers.paystackWebhooks();
    if (!provider || !req.rawBody) throw Errors.notFound('Webhook');
    let event;
    try {
      event = provider.parseWebhook(req.rawBody, req.headers);
    } catch (error) {
      if (error instanceof InvalidWebhookSignature) {
        this.logger.warn(`Rejected webhook with an invalid signature from ${req.ip}`);
        throw new AppException(HttpStatus.UNAUTHORIZED, ErrorCode.FORBIDDEN, 'Invalid signature.');
      }
      throw Errors.badRequest('Malformed webhook payload.');
    }
    if (!event) return ok({ received: true });

    try {
      // Subscription payments ("HHS-…") and booking payments ("HHP-…") share
      // one provider account and webhook; the reference says which it is.
      if (event.type === 'charge.success') {
        if (event.reference.startsWith('HHS-')) await this.subscriptions.settle(event.reference);
        else await this.payments.settle(event.reference);
      }
      if (event.type === 'refund.processed')
        await this.refunds.completeByPaymentReference(event.reference);
      if (event.type === 'refund.failed') {
        await this.refunds.failByPaymentReference(event.reference, event.message);
      }
    } catch (error) {
      // Unknown references are acknowledged (not ours / already handled);
      // anything else is surfaced so the provider retries.
      if (error instanceof AppException && error.code === ErrorCode.NOT_FOUND) {
        this.logger.warn(`Webhook for unknown reference ${event.reference}`);
        return ok({ received: true });
      }
      throw error;
    }
    return ok({ received: true });
  }
}

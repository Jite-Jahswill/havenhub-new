import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  AccountType,
  SUBSCRIPTION_REFERENCE,
  cancelSubscriptionSchema,
  subscriptionCheckoutSchema,
  subscriptionQuoteQuerySchema,
  testCheckoutSchema,
} from '@havenhub/shared';
import type { Request } from 'express';
import type { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
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
} from '../auth/decorators/auth.decorators';
import { SubscriptionPlansService } from './subscription-plans.service';
import { SubscriptionsService } from './subscriptions.service';

function validReference(reference: string): string {
  if (!SUBSCRIPTION_REFERENCE.test(reference)) throw Errors.notFound('Payment');
  return reference;
}

/** Plans on offer — public, so marketing pages and the mobile app can show pricing. */
@Controller('subscriptions')
export class SubscriptionPlansController {
  constructor(private readonly plans: SubscriptionPlansService) {}

  @Get('plans')
  @Public()
  async plansOnOffer() {
    return ok(await this.plans.offered());
  }
}

/**
 * The signed-in agent's own subscription. No endpoint takes an agent or
 * subscription id, so one agent can never reach another's.
 */
@Controller('agents/me/subscription')
@AccountTypes(AccountType.AGENT)
@RequireVerifiedEmail()
export class AgentSubscriptionController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  async current(@CurrentAuth() auth: AuthContext) {
    return ok(await this.subscriptions.current(auth.user.id));
  }

  /** What choosing this plan would cost and when it would apply — before paying. */
  @Get('quote')
  async quote(
    @CurrentAuth() auth: AuthContext,
    @Query(validate(subscriptionQuoteQuerySchema))
    query: z.output<typeof subscriptionQuoteQuerySchema>,
  ) {
    return ok(await this.subscriptions.quote(auth.user.id, query.planId));
  }

  @Post('checkout')
  @RateLimit({ name: 'subscription-checkout:user', limit: 20, windowSeconds: 3600, by: 'user' })
  async checkout(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(subscriptionCheckoutSchema)) body: z.output<typeof subscriptionCheckoutSchema>,
    @Req() req: Request,
  ) {
    return ok(
      await this.subscriptions.checkout(
        { id: auth.user.id, email: auth.user.email },
        body.planId,
        requestMeta(req),
      ),
    );
  }

  /** Only the reference comes from the browser; the outcome comes from the provider. */
  @Post('payments/:reference/verify')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'subscription-verify:user', limit: 60, windowSeconds: 600, by: 'user' })
  async verify(@CurrentAuth() auth: AuthContext, @Param('reference') reference: string) {
    return ok(await this.subscriptions.verifyForAgent(auth.user.id, validReference(reference)));
  }

  @Get('history')
  async history(@CurrentAuth() auth: AuthContext) {
    return ok(await this.subscriptions.history(auth.user.id));
  }

  @Get('payments')
  async payments(@CurrentAuth() auth: AuthContext) {
    return ok(await this.subscriptions.payments(auth.user.id));
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(cancelSubscriptionSchema)) body: z.output<typeof cancelSubscriptionSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.subscriptions.cancel(auth.user.id, body, requestMeta(req)));
  }

  @Post('resume')
  @HttpCode(HttpStatus.OK)
  async resume(@CurrentAuth() auth: AuthContext, @Req() req: Request) {
    return ok(await this.subscriptions.resume(auth.user.id, requestMeta(req)));
  }

  // ── Development test checkout (404 unless PAYMENT_PROVIDER=test outside production) ──

  @Get('test-checkout/:reference')
  async testCheckout(@CurrentAuth() auth: AuthContext, @Param('reference') reference: string) {
    return ok(await this.subscriptions.testCheckout(auth.user.id, validReference(reference)));
  }

  @Post('test-checkout/:reference')
  @HttpCode(HttpStatus.OK)
  async completeTestCheckout(
    @CurrentAuth() auth: AuthContext,
    @Param('reference') reference: string,
    @Body(validate(testCheckoutSchema)) body: z.output<typeof testCheckoutSchema>,
  ) {
    return ok(
      await this.subscriptions.completeTestCheckout(
        auth.user.id,
        validReference(reference),
        body.outcome,
      ),
    );
  }
}

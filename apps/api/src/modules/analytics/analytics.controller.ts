import { Controller, Get, Query } from '@nestjs/common';
import { AccountType, analyticsQuerySchema } from '@havenhub/shared';
import type { z } from 'zod';

import { ok } from '../../common/http/response';
import { validate } from '../../common/pipes/zod-validation.pipe';
import type { AuthContext } from '../auth/auth.types';
import {
  AccountTypes,
  CurrentAuth,
  RequirePermissions,
  RequireVerifiedEmail,
} from '../auth/decorators/auth.decorators';
import { AnalyticsService } from './analytics.service';

type Query = z.output<typeof analyticsQuerySchema>;

@Controller('admin/analytics')
@AccountTypes(AccountType.ADMIN)
@RequireVerifiedEmail()
export class AdminAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @RequirePermissions('analytics.view')
  async overview(@Query(validate(analyticsQuerySchema)) query: Query) {
    return ok(await this.analytics.platform(query));
  }

  /** Money is a separate permission from the general figures. */
  @Get('financial')
  @RequirePermissions('analytics.financial')
  async financial(@Query(validate(analyticsQuerySchema)) query: Query) {
    return ok(await this.analytics.financial(query));
  }
}

@Controller('agents/me/analytics')
@AccountTypes(AccountType.AGENT)
@RequireVerifiedEmail()
export class AgentAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  async mine(
    @CurrentAuth() auth: AuthContext,
    @Query(validate(analyticsQuerySchema)) query: Query,
  ) {
    return ok(await this.analytics.agent(auth.user.id, query));
  }
}

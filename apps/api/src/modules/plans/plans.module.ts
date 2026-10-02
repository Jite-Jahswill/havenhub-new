import { Global, Module } from '@nestjs/common';

import { LimitNotifier } from './limit-notifier';
import { PlanLimitsService } from './plan-limits.service';
import { PlanUsageService } from './plan-usage.service';

/**
 * Plan allowances: resolution, enforcement and usage. Global, because
 * property, media and (later) event modules all enforce them.
 */
@Global()
@Module({
  providers: [PlanLimitsService, PlanUsageService, LimitNotifier],
  exports: [PlanLimitsService, PlanUsageService],
})
export class PlansModule {}

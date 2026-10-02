import { Module } from '@nestjs/common';

import { FinanceModule } from '../finance/finance.module';
import {
  AdminSubscriptionPlansController,
  AdminSubscriptionsController,
} from './admin-subscriptions.controller';
import { SubscriptionAdminService } from './subscription-admin.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';
import { SubscriptionMaintenanceService } from './subscription-maintenance.service';
import { SubscriptionNotifier } from './subscription-notifier';
import { SubscriptionPlansService } from './subscription-plans.service';
import {
  AgentSubscriptionController,
  SubscriptionPlansController,
} from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Agent subscriptions (Phase 4): admin-managed plans, paid terms bought
 * through the shared payment-provider abstraction, and the sweep that keeps
 * terms current. Allowance enforcement itself lives in the global
 * PlansModule, which every listing module already uses.
 */
@Module({
  imports: [FinanceModule],
  controllers: [
    SubscriptionPlansController,
    AgentSubscriptionController,
    AdminSubscriptionPlansController,
    AdminSubscriptionsController,
  ],
  providers: [
    SubscriptionsService,
    SubscriptionPlansService,
    SubscriptionAdminService,
    SubscriptionLifecycleService,
    SubscriptionMaintenanceService,
    SubscriptionNotifier,
  ],
  exports: [SubscriptionsService, SubscriptionMaintenanceService],
})
export class SubscriptionsModule {}

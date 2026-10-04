import { Module } from '@nestjs/common';

import { BookingsModule } from '../bookings/bookings.module';
import { FinanceModule } from '../finance/finance.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AdminFinanceController } from './admin-finance.controller';
import { FinanceQueriesService } from './finance-queries.service';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { CustomerPaymentsController, PaymentWebhooksController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [FinanceModule, BookingsModule, SubscriptionsModule],
  controllers: [CustomerPaymentsController, PaymentWebhooksController, AdminFinanceController],
  providers: [PaymentsService, FinanceQueriesService, PaymentReconciliationService],
})
export class PaymentsModule {}

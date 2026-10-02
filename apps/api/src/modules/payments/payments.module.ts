import { Module } from '@nestjs/common';

import { BookingsModule } from '../bookings/bookings.module';
import { FinanceModule } from '../finance/finance.module';
import { AdminFinanceController } from './admin-finance.controller';
import { FinanceQueriesService } from './finance-queries.service';
import { CustomerPaymentsController, PaymentWebhooksController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [FinanceModule, BookingsModule],
  controllers: [CustomerPaymentsController, PaymentWebhooksController, AdminFinanceController],
  providers: [PaymentsService, FinanceQueriesService],
})
export class PaymentsModule {}

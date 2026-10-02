import { Module } from '@nestjs/common';

import { LedgerService } from './ledger.service';
import { PricingConfigService } from './pricing-config.service';
import { PaymentProviders } from './providers/payment-providers.service';
import { TestPaymentProvider } from './providers/test-payment.provider';
import { RefundsService } from './refunds.service';

/**
 * Money infrastructure shared by bookings and payments: provider adapters,
 * the ledger, refunds and the configurable rates. Depends on neither bookings
 * nor payments, so both can use it without cycles.
 */
@Module({
  providers: [
    TestPaymentProvider,
    PaymentProviders,
    LedgerService,
    RefundsService,
    PricingConfigService,
  ],
  exports: [
    TestPaymentProvider,
    PaymentProviders,
    LedgerService,
    RefundsService,
    PricingConfigService,
  ],
})
export class FinanceModule {}

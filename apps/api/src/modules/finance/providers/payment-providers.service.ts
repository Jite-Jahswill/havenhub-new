import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ErrorCode, PaymentProviderName } from '@havenhub/shared';

import { AppException } from '../../../common/errors/app.exception';
import { ENV } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import type { PaymentProvider } from './payment-provider';
import { PaystackProvider } from './paystack.provider';
import { TestPaymentProvider } from './test-payment.provider';

/** Resolves providers by name. New providers register here and nowhere else. */
@Injectable()
export class PaymentProviders {
  private readonly paystack: PaystackProvider | null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly test: TestPaymentProvider,
  ) {
    this.paystack = env.PAYSTACK_SECRET_KEY
      ? new PaystackProvider(env.PAYSTACK_SECRET_KEY, env.PAYSTACK_BASE_URL)
      : null;
  }

  /** The provider new payments are taken with. */
  active(): PaymentProvider {
    return this.get(
      this.env.PAYMENT_PROVIDER === 'paystack'
        ? PaymentProviderName.PAYSTACK
        : PaymentProviderName.TEST,
    );
  }

  /** The provider an existing payment was made with (for verification and refunds). */
  get(name: PaymentProviderName): PaymentProvider {
    if (name === PaymentProviderName.PAYSTACK && this.paystack) return this.paystack;
    if (name === PaymentProviderName.TEST && this.env.NODE_ENV !== 'production') return this.test;
    throw new AppException(
      HttpStatus.SERVICE_UNAVAILABLE,
      ErrorCode.PAYMENT_PROVIDER_ERROR,
      'Payments are temporarily unavailable.',
    );
  }

  /** Paystack, for authenticating its webhooks; null when not configured. */
  paystackWebhooks(): PaystackProvider | null {
    return this.paystack;
  }

  get testProviderEnabled(): boolean {
    return this.env.PAYMENT_PROVIDER === 'test' && this.env.NODE_ENV !== 'production';
  }
}

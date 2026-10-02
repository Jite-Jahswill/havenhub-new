import { Inject, Injectable } from '@nestjs/common';
import { PaymentProviderName } from '@havenhub/shared';

import { ENV } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import {
  PaymentProviderError,
  type InitializePaymentInput,
  type PaymentProvider,
  type ProviderRefundResult,
  type ProviderVerification,
  type ProviderWebhookEvent,
} from './payment-provider';

interface SimulatedTransaction {
  reference: string;
  amountKobo: string;
  currency: string;
  outcome: 'pending' | 'success' | 'failed';
}

const key = (reference: string) => `testpay:${reference}`;
const TTL_SECONDS = 7 * 24 * 3600;

/**
 * Development-only stand-in for a real provider. "Paying" happens on the web
 * app's test checkout page, which records an outcome here; settlement then
 * runs the normal server-side verification path against this record. No money
 * moves. Never available in production (env validation and PaymentProviders).
 */
@Injectable()
export class TestPaymentProvider implements PaymentProvider {
  readonly name = PaymentProviderName.TEST;

  constructor(
    private readonly redis: RedisService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async initialize(input: InitializePaymentInput): Promise<{ authorizationUrl: string }> {
    await this.save({
      reference: input.reference,
      amountKobo: input.amountKobo.toString(),
      currency: input.currency,
      outcome: 'pending',
    });
    return {
      authorizationUrl: `${this.env.WEB_APP_URL}/payments/test-checkout?reference=${encodeURIComponent(input.reference)}`,
    };
  }

  /**
   * Records what the simulated customer did. Tests may also make the
   * provider report a different amount, currency or reference, to exercise
   * the server's verification checks.
   */
  async simulate(
    reference: string,
    outcome: 'success' | 'failed',
    report: Partial<Pick<SimulatedTransaction, 'amountKobo' | 'currency' | 'reference'>> = {},
  ): Promise<void> {
    const current = await this.load(reference);
    if (!current) throw new PaymentProviderError('Unknown test transaction');
    await this.save({ ...current, ...report, outcome }, reference);
  }

  async verify(reference: string): Promise<ProviderVerification> {
    const tx = await this.load(reference);
    if (!tx) throw new PaymentProviderError('Transaction reference not found');
    return {
      status: tx.outcome,
      reference: tx.reference,
      amountKobo: BigInt(tx.amountKobo),
      currency: tx.currency,
      providerTransactionId: tx.outcome === 'pending' ? null : `test_${reference}`,
      paidAt: tx.outcome === 'success' ? new Date() : null,
      message: tx.outcome === 'failed' ? 'Declined (simulated)' : null,
    };
  }

  refund(input: { reference: string }): Promise<ProviderRefundResult> {
    return Promise.resolve({
      status: 'completed',
      providerRefundId: `test_refund_${input.reference}`,
      message: null,
    });
  }

  parseWebhook(): ProviderWebhookEvent | null {
    return null;
  }

  private async load(reference: string): Promise<SimulatedTransaction | null> {
    const raw = await this.redis.client.get(key(reference));
    return raw ? (JSON.parse(raw) as SimulatedTransaction) : null;
  }

  private async save(tx: SimulatedTransaction, reference = tx.reference): Promise<void> {
    await this.redis.client.set(key(reference), JSON.stringify(tx), 'EX', TTL_SECONDS);
  }
}

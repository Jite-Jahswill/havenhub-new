import { Inject, Injectable } from '@nestjs/common';
import { PaymentProviderName } from '@havenhub/shared';

import { ENV } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import {
  PaymentProviderError,
  type InitializePaymentInput,
  type PaymentProvider,
  type ProviderRefundLookup,
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
const refundKey = (reference: string) => `testpay:refund:${reference}`;
const refundModeKey = (reference: string) => `testpay:refund-mode:${reference}`;
const refundCallsKey = (reference: string) => `testpay:refund-calls:${reference}`;

/**
 * How the simulated provider answers refund requests (tests only):
 *  - `complete` (default): refunded at once;
 *  - `processing`: accepted, confirmed later;
 *  - `reject`: refused;
 *  - `lost-response`: refunded, but the answer never arrives (timeout);
 *  - `unreachable`: the request never reaches the provider (timeout);
 *  - `lookup-unreachable`: refund lookups time out.
 */
export type SimulatedRefundMode =
  'complete' | 'processing' | 'reject' | 'lost-response' | 'unreachable' | 'lookup-unreachable';

interface SimulatedRefund {
  id: string;
  status: 'completed' | 'processing';
}
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

  async refund(input: { reference: string }): Promise<ProviderRefundResult> {
    await this.redis.client.incr(refundCallsKey(input.reference));
    const mode = await this.refundMode(input.reference);
    if (mode === 'unreachable') {
      throw new PaymentProviderError('Simulated timeout', { outcomeUnknown: true });
    }
    // Like a real provider, a payment can only be refunded once.
    if (await this.redis.client.get(refundKey(input.reference))) {
      throw new PaymentProviderError('Transaction has been fully reversed');
    }
    if (mode === 'reject') {
      return { status: 'failed', providerRefundId: null, message: 'Refused (simulated)' };
    }
    const refund: SimulatedRefund = {
      id: `test_refund_${input.reference}`,
      status: mode === 'processing' ? 'processing' : 'completed',
    };
    await this.redis.client.set(
      refundKey(input.reference),
      JSON.stringify(refund),
      'EX',
      TTL_SECONDS,
    );
    if (mode === 'lost-response') {
      throw new PaymentProviderError('Simulated timeout after the refund', {
        outcomeUnknown: true,
      });
    }
    return { status: refund.status, providerRefundId: refund.id, message: null };
  }

  async findRefund(input: { reference: string }): Promise<ProviderRefundLookup> {
    if ((await this.refundMode(input.reference)) === 'lookup-unreachable') {
      throw new PaymentProviderError('Simulated timeout', { outcomeUnknown: true });
    }
    const raw = await this.redis.client.get(refundKey(input.reference));
    if (!raw) return { status: 'none', providerRefundId: null, message: null };
    const refund = JSON.parse(raw) as SimulatedRefund;
    return { status: refund.status, providerRefundId: refund.id, message: null };
  }

  /** Tests: how refund requests for this payment behave from now on. */
  async simulateRefund(reference: string, mode: SimulatedRefundMode): Promise<void> {
    await this.redis.client.set(refundModeKey(reference), mode, 'EX', TTL_SECONDS);
  }

  /** Tests: the simulated provider confirms an accepted refund later. */
  async settleSimulatedRefund(reference: string): Promise<void> {
    const raw = await this.redis.client.get(refundKey(reference));
    if (!raw) throw new PaymentProviderError('No simulated refund');
    const refund = JSON.parse(raw) as SimulatedRefund;
    await this.redis.client.set(
      refundKey(reference),
      JSON.stringify({ ...refund, status: 'completed' }),
      'EX',
      TTL_SECONDS,
    );
  }

  /** Tests: how many refund requests reached the provider for this payment. */
  async refundRequests(reference: string): Promise<number> {
    return Number((await this.redis.client.get(refundCallsKey(reference))) ?? 0);
  }

  private async refundMode(reference: string): Promise<SimulatedRefundMode> {
    return ((await this.redis.client.get(refundModeKey(reference))) ??
      'complete') as SimulatedRefundMode;
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

import { createHmac, timingSafeEqual } from 'node:crypto';

import { PaymentProviderName } from '@havenhub/shared';

import {
  InvalidWebhookSignature,
  PaymentProviderError,
  type InitializePaymentInput,
  type PaymentProvider,
  type ProviderRefundResult,
  type ProviderVerification,
  type ProviderWebhookEvent,
} from './payment-provider';

interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

type Fetch = typeof fetch;

/**
 * Paystack (https://paystack.com/docs/api). Amounts are kobo, as Paystack
 * expects for NGN. The secret key never leaves the server.
 */
export class PaystackProvider implements PaymentProvider {
  readonly name = PaymentProviderName.PAYSTACK;

  constructor(
    private readonly secretKey: string,
    private readonly baseUrl = 'https://api.paystack.co',
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async initialize(input: InitializePaymentInput): Promise<{ authorizationUrl: string }> {
    const data = await this.call<{ authorization_url: string }>('POST', '/transaction/initialize', {
      email: input.email,
      amount: input.amountKobo.toString(),
      currency: input.currency,
      reference: input.reference,
      callback_url: input.callbackUrl,
      metadata: input.metadata,
    });
    return { authorizationUrl: data.authorization_url };
  }

  async verify(reference: string): Promise<ProviderVerification> {
    const data = await this.call<{
      id: number;
      status: string;
      reference: string;
      amount: number | string;
      currency: string;
      paid_at: string | null;
      gateway_response: string | null;
    }>('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    return {
      status:
        data.status === 'success' ? 'success' : FAILED.has(data.status) ? 'failed' : 'pending',
      reference: data.reference,
      amountKobo: BigInt(data.amount),
      currency: data.currency,
      providerTransactionId: String(data.id),
      paidAt: data.paid_at ? new Date(data.paid_at) : null,
      message: data.gateway_response,
    };
  }

  async refund(input: { reference: string; amountKobo: bigint }): Promise<ProviderRefundResult> {
    const data = await this.call<{ id: number; status: string }>('POST', '/refund', {
      transaction: input.reference,
      amount: input.amountKobo.toString(),
    });
    const status =
      data.status === 'processed'
        ? 'completed'
        : data.status === 'failed'
          ? 'failed'
          : 'processing';
    return { status, providerRefundId: String(data.id), message: null };
  }

  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): ProviderWebhookEvent | null {
    const signature = headers['x-paystack-signature'];
    const expected = createHmac('sha512', this.secretKey).update(rawBody).digest('hex');
    if (
      typeof signature !== 'string' ||
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      throw new InvalidWebhookSignature('Invalid Paystack signature');
    }
    const body = JSON.parse(rawBody.toString('utf8')) as {
      event?: string;
      data?: {
        reference?: string;
        transaction_reference?: string;
        transaction?: { reference?: string };
        message?: string;
      };
    };
    const data = body.data ?? {};
    switch (body.event) {
      case 'charge.success':
        return data.reference ? { type: 'charge.success', reference: data.reference } : null;
      case 'refund.processed':
      case 'refund.failed': {
        const reference = data.transaction_reference ?? data.transaction?.reference;
        if (!reference) return null;
        return body.event === 'refund.processed'
          ? { type: 'refund.processed', reference }
          : { type: 'refund.failed', reference, message: data.message ?? null };
      }
      default:
        return null;
    }
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new PaymentProviderError(`Paystack unreachable: ${(error as Error).message}`);
    }
    const payload = (await res.json().catch(() => null)) as PaystackEnvelope<T> | null;
    if (!res.ok || !payload?.status) {
      throw new PaymentProviderError(
        `Paystack ${method} ${path.split('/').slice(0, 3).join('/')} failed (${res.status}): ${payload?.message ?? 'no response body'}`,
      );
    }
    return payload.data;
  }
}

const FAILED = new Set(['failed', 'reversed']);

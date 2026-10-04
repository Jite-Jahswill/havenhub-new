import { createHmac, timingSafeEqual } from 'node:crypto';

import { PaymentProviderName } from '@havenhub/shared';

import {
  InvalidWebhookSignature,
  PaymentProviderError,
  type InitializePaymentInput,
  type PaymentProvider,
  type ProviderRefundLookup,
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

  /**
   * Lists the refunds of a transaction (GET /refund?transaction=…). Any
   * completed refund wins, then one still in progress; "none" only when the
   * provider has no refund for it at all.
   *
   * The list filter is not trusted: only refunds that name this payment's
   * transaction (`transaction`, Paystack's transaction id, or
   * `transaction_reference`, our reference) are considered, so a refund of
   * another payment is never adopted. A response, or a listed refund, that
   * cannot be attributed makes the outcome unknown rather than "none".
   */
  async findRefund(input: {
    reference: string;
    providerTransactionId: string | null;
  }): Promise<ProviderRefundLookup> {
    const transaction = encodeURIComponent(input.providerTransactionId ?? input.reference);
    const listed = await this.call<unknown>(
      'GET',
      `/refund?transaction=${transaction}&perPage=100`,
    );
    if (!Array.isArray(listed)) throw unreadableRefunds();
    const refunds: ListedRefund[] = [];
    for (const item of listed) {
      const refund = readListedRefund(item);
      if (!refund) throw unreadableRefunds();
      const ours = refundBelongsTo(refund, input);
      if (ours === null) throw unreadableRefunds();
      if (ours) refunds.push(refund);
    }
    const pick = (statuses: string[]) => refunds.find((r) => statuses.includes(r.status));
    const done = pick(['processed']);
    if (done) return { status: 'completed', providerRefundId: String(done.id), message: null };
    const open = refunds.find((r) => r.status !== 'failed');
    if (open) return { status: 'processing', providerRefundId: String(open.id), message: null };
    const failed = pick(['failed']);
    if (failed) return { status: 'failed', providerRefundId: String(failed.id), message: null };
    return { status: 'none', providerRefundId: null, message: null };
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
      // Timeout or network failure: the request may still have been processed.
      throw new PaymentProviderError(`Paystack unreachable: ${(error as Error).message}`, {
        outcomeUnknown: true,
      });
    }
    const payload = (await res.json().catch(() => null)) as PaystackEnvelope<T> | null;
    if (!res.ok || !payload?.status) {
      throw new PaymentProviderError(
        `Paystack ${method} ${path.split('?')[0]!.split('/').slice(0, 3).join('/')} failed (${res.status}): ${payload?.message ?? 'no response body'}`,
        // A server error or unreadable answer does not prove the request failed.
        { outcomeUnknown: res.status >= 500 || payload === null },
      );
    }
    return payload.data;
  }
}

const FAILED = new Set(['failed', 'reversed']);

/** A refund from GET /refund, reduced to what is needed to attribute it. */
interface ListedRefund {
  id: string;
  status: string;
  /** Paystack's id of the refunded transaction (`transaction`, an integer). */
  transactionId: string | null;
  /** Our reference of the refunded transaction (`transaction_reference`). */
  reference: string | null;
}

/** The listed refund, or null when it is unreadable or names no transaction. */
function readListedRefund(item: unknown): ListedRefund | null {
  if (typeof item !== 'object' || item === null) return null;
  const r = item as Record<string, unknown>;
  const id = typeof r.id === 'number' || typeof r.id === 'string' ? String(r.id) : '';
  if (!id || typeof r.status !== 'string') return null;
  let transactionId: string | null = null;
  if (typeof r.transaction === 'number' && Number.isSafeInteger(r.transaction)) {
    transactionId = String(r.transaction);
  } else if (typeof r.transaction === 'string' && /^(0|[1-9]\d*)$/.test(r.transaction)) {
    transactionId = r.transaction;
  } else if (r.transaction !== undefined && r.transaction !== null) {
    return null; // present but not a transaction id: cannot be attributed
  }
  let reference: string | null = null;
  if (typeof r.transaction_reference === 'string' && r.transaction_reference !== '') {
    reference = r.transaction_reference;
  } else if (r.transaction_reference !== undefined && r.transaction_reference !== null) {
    return null;
  }
  if (transactionId === null && reference === null) return null;
  return { id, status: r.status, transactionId, reference };
}

/**
 * Whether a listed refund is for this payment: every identifier both sides
 * know must agree, and at least one must. Null when nothing can be compared
 * (the refund names only a transaction id and the payment has none).
 */
function refundBelongsTo(
  refund: ListedRefund,
  payment: { reference: string; providerTransactionId: string | null },
): boolean | null {
  const byId =
    refund.transactionId !== null && payment.providerTransactionId !== null
      ? refund.transactionId === payment.providerTransactionId
      : null;
  const byReference = refund.reference !== null ? refund.reference === payment.reference : null;
  if (byId === false || byReference === false) return false;
  return byId === true || byReference === true ? true : null;
}

const unreadableRefunds = () =>
  new PaymentProviderError('Paystack refund list could not be attributed to the transaction', {
    outcomeUnknown: true,
  });

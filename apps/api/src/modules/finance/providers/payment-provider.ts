import type { PaymentProviderName } from '@havenhub/shared';

/**
 * What HavenHub needs from a payment provider. Booking and finance code depend
 * only on this interface; Paystack specifics stay inside its implementation.
 *
 * The browser is never trusted: a payment is settled only from `verify`,
 * called by the server, whatever the redirect or webhook claimed.
 */
export interface PaymentProvider {
  readonly name: PaymentProviderName;

  initialize(input: InitializePaymentInput): Promise<{ authorizationUrl: string }>;

  /** Asks the provider, server to server, what really happened. */
  verify(reference: string): Promise<ProviderVerification>;

  refund(input: { reference: string; amountKobo: bigint }): Promise<ProviderRefundResult>;

  /**
   * What the provider knows about refunds of a payment, without changing
   * anything. Asked before every refund request, so a refund whose earlier
   * attempt may have reached the provider is never sent twice.
   */
  findRefund(input: {
    reference: string;
    providerTransactionId: string | null;
  }): Promise<ProviderRefundLookup>;

  /**
   * Authenticates and parses a webhook. Throws `InvalidWebhookSignature`
   * when the signature does not match; returns null for ignored events.
   */
  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): ProviderWebhookEvent | null;
}

export interface InitializePaymentInput {
  reference: string;
  amountKobo: bigint;
  currency: 'NGN';
  email: string;
  callbackUrl: string;
  metadata: Record<string, string>;
}

export interface ProviderVerification {
  /** `pending` = not finished yet (abandoned/ongoing); settle later. */
  status: 'success' | 'failed' | 'pending';
  reference: string;
  amountKobo: bigint;
  currency: string;
  providerTransactionId: string | null;
  paidAt: Date | null;
  message: string | null;
}

export interface ProviderRefundResult {
  status: 'completed' | 'processing' | 'failed';
  providerRefundId: string | null;
  message: string | null;
}

/** `none` = the provider has no refund for the payment at all. */
export interface ProviderRefundLookup {
  status: 'completed' | 'processing' | 'failed' | 'none';
  providerRefundId: string | null;
  message: string | null;
}

export type ProviderWebhookEvent =
  | { type: 'charge.success'; reference: string }
  | { type: 'refund.processed'; reference: string }
  | { type: 'refund.failed'; reference: string; message: string | null };

export class InvalidWebhookSignature extends Error {}

/**
 * Why a provider's verification does not match what we asked for, or null.
 * Money that moved differently from what was agreed is never accepted.
 */
export function verificationMismatch(
  expected: { reference: string; amountKobo: bigint; currency: string },
  v: ProviderVerification,
): string | null {
  if (v.reference !== expected.reference) return 'reference';
  if (v.amountKobo !== expected.amountKobo)
    return `amount (expected ${expected.amountKobo}, got ${v.amountKobo})`;
  if (v.currency !== expected.currency)
    return `currency (expected ${expected.currency}, got ${v.currency})`;
  return null;
}

/**
 * A provider call that failed for reasons other than the payment itself.
 *
 * `outcomeUnknown` is true when the request may have reached the provider
 * and taken effect (timeout, network failure, 5xx, unreadable response):
 * the caller must not assume it failed. False means the provider answered
 * and refused the request.
 */
export class PaymentProviderError extends Error {
  readonly outcomeUnknown: boolean;

  constructor(message: string, options: { outcomeUnknown?: boolean } = {}) {
    super(message);
    this.name = 'PaymentProviderError';
    this.outcomeUnknown = options.outcomeUnknown ?? false;
  }
}

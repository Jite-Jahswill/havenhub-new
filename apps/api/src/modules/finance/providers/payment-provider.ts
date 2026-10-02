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

export type ProviderWebhookEvent =
  | { type: 'charge.success'; reference: string }
  | { type: 'refund.processed'; reference: string }
  | { type: 'refund.failed'; reference: string; message: string | null };

export class InvalidWebhookSignature extends Error {}

/** A provider call that failed for reasons other than the payment itself. */
export class PaymentProviderError extends Error {}

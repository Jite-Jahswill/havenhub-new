import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { InvalidWebhookSignature, PaymentProviderError } from './payment-provider';
import { PaystackProvider } from './paystack.provider';

const SECRET = 'sk_test_unit';

function fakeFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

const sign = (body: string, secret = SECRET) =>
  createHmac('sha512', secret).update(body).digest('hex');

describe('PaystackProvider', () => {
  it('initialises in kobo with our reference and the secret key', async () => {
    const fetch = fakeFetch(200, {
      status: true,
      message: 'ok',
      data: { authorization_url: 'https://checkout.paystack.com/abc' },
    });
    const provider = new PaystackProvider(SECRET, 'https://api.test', fetch);
    const result = await provider.initialize({
      reference: 'HHP-1',
      amountKobo: 19_612_500n,
      currency: 'NGN',
      email: 'c@example.com',
      callbackUrl: 'https://havenhub.ng/account/bookings/1',
      metadata: { bookingId: '1' },
    });
    expect(result.authorizationUrl).toBe('https://checkout.paystack.com/abc');
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/transaction/initialize');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(init.body as string)).toMatchObject({
      amount: '19612500',
      reference: 'HHP-1',
      currency: 'NGN',
    });
  });

  it('maps verification results', async () => {
    const verify = async (status: string) =>
      new PaystackProvider(
        SECRET,
        'https://api.test',
        fakeFetch(200, {
          status: true,
          message: 'ok',
          data: {
            id: 42,
            status,
            reference: 'HHP-1',
            amount: 19_612_500,
            currency: 'NGN',
            paid_at: '2027-01-01T10:00:00.000Z',
            gateway_response: 'Approved',
          },
        }),
      ).verify('HHP-1');
    expect(await verify('success')).toMatchObject({
      status: 'success',
      amountKobo: 19_612_500n,
      currency: 'NGN',
      providerTransactionId: '42',
    });
    expect((await verify('failed')).status).toBe('failed');
    expect((await verify('reversed')).status).toBe('failed');
    expect((await verify('abandoned')).status).toBe('pending');
    expect((await verify('ongoing')).status).toBe('pending');
  });

  it('turns API and network errors into PaymentProviderError', async () => {
    const notFound = new PaystackProvider(
      SECRET,
      'https://api.test',
      fakeFetch(400, { status: false, message: 'Transaction reference not found' }),
    );
    await expect(notFound.verify('HHP-x')).rejects.toThrow(PaymentProviderError);
    const down = new PaystackProvider(
      SECRET,
      'https://api.test',
      vi.fn().mockRejectedValue(new Error('ECONNRESET')),
    );
    await expect(down.verify('HHP-x')).rejects.toThrow(/unreachable/);
  });

  it('maps refund states', async () => {
    const refund = (status: string) =>
      new PaystackProvider(
        SECRET,
        'https://api.test',
        fakeFetch(200, { status: true, message: 'ok', data: { id: 7, status } }),
      ).refund({ reference: 'HHP-1', amountKobo: 100n });
    expect(await refund('processed')).toMatchObject({ status: 'completed', providerRefundId: '7' });
    expect((await refund('pending')).status).toBe('processing');
    expect((await refund('failed')).status).toBe('failed');
  });

  describe('webhooks', () => {
    const provider = new PaystackProvider(SECRET);

    it('accepts a correctly signed charge.success', () => {
      const body = JSON.stringify({ event: 'charge.success', data: { reference: 'HHP-1' } });
      expect(
        provider.parseWebhook(Buffer.from(body), { 'x-paystack-signature': sign(body) }),
      ).toEqual({ type: 'charge.success', reference: 'HHP-1' });
    });

    it('maps refund events to the original transaction reference', () => {
      const body = JSON.stringify({
        event: 'refund.processed',
        data: { transaction_reference: 'HHP-1' },
      });
      expect(
        provider.parseWebhook(Buffer.from(body), { 'x-paystack-signature': sign(body) }),
      ).toEqual({ type: 'refund.processed', reference: 'HHP-1' });
    });

    it('rejects missing, wrong or tampered signatures', () => {
      const body = JSON.stringify({ event: 'charge.success', data: { reference: 'HHP-1' } });
      expect(() => provider.parseWebhook(Buffer.from(body), {})).toThrow(InvalidWebhookSignature);
      expect(() =>
        provider.parseWebhook(Buffer.from(body), {
          'x-paystack-signature': sign(body, 'sk_other'),
        }),
      ).toThrow(InvalidWebhookSignature);
      expect(() =>
        provider.parseWebhook(Buffer.from(body.replace('HHP-1', 'HHP-2')), {
          'x-paystack-signature': sign(body),
        }),
      ).toThrow(InvalidWebhookSignature);
    });

    it('ignores events it does not handle', () => {
      const body = JSON.stringify({ event: 'transfer.success', data: {} });
      expect(
        provider.parseWebhook(Buffer.from(body), { 'x-paystack-signature': sign(body) }),
      ).toBeNull();
    });
  });
});

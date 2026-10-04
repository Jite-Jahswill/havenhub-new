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

  describe('ambiguous vs definite failures', () => {
    const provider = (fetch: ReturnType<typeof vi.fn>) =>
      new PaystackProvider(SECRET, 'https://api.test', fetch as unknown as typeof globalThis.fetch);
    const refundOf = (p: PaystackProvider) => p.refund({ reference: 'HHP-1', amountKobo: 100n });
    const caught = async (promise: Promise<unknown>) => {
      try {
        await promise;
      } catch (error) {
        return error as PaymentProviderError;
      }
      throw new Error('expected an error');
    };

    it('treats timeouts, network errors, 5xx and unreadable answers as outcome unknown', async () => {
      const timeout = vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
      expect((await caught(refundOf(provider(timeout)))).outcomeUnknown).toBe(true);
      const server = fakeFetch(502, { status: false, message: 'Bad gateway' });
      expect((await caught(refundOf(provider(server)))).outcomeUnknown).toBe(true);
      const garbage = vi.fn().mockResolvedValue(new Response('<html>oops</html>', { status: 200 }));
      expect((await caught(refundOf(provider(garbage)))).outcomeUnknown).toBe(true);
    });

    it('treats an explicit refusal (4xx) as a definite failure', async () => {
      const refused = fakeFetch(400, {
        status: false,
        message: 'Transaction has been fully reversed',
      });
      const error = await caught(refundOf(provider(refused)));
      expect(error).toBeInstanceOf(PaymentProviderError);
      expect(error.outcomeUnknown).toBe(false);
      expect(error.message).toContain('fully reversed');
      expect(error.message).not.toContain(SECRET);
    });
  });

  describe('findRefund', () => {
    // Paystack's GET /refund items name the refunded transaction by id
    // (`transaction`, an integer) and by reference (`transaction_reference`).
    const ours = { transaction: 987, transaction_reference: 'HHP-1' };
    const other = { transaction: 555, transaction_reference: 'HHP-OTHER' };
    const listing = (data: unknown) => {
      const fetch = fakeFetch(200, { status: true, message: 'ok', data });
      const provider = new PaystackProvider(SECRET, 'https://api.test', fetch);
      return { fetch, provider };
    };
    const lookup = (data: unknown, providerTransactionId: string | null = '987') => {
      const { fetch, provider } = listing(data);
      return { fetch, result: provider.findRefund({ reference: 'HHP-1', providerTransactionId }) };
    };
    const unknownOutcome = async (data: unknown, providerTransactionId: string | null = '987') => {
      const error = await lookup(data, providerTransactionId).result.then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(PaymentProviderError);
      expect((error as PaymentProviderError).outcomeUnknown).toBe(true);
    };

    it('lists refunds by transaction id and prefers a completed one', async () => {
      const { fetch, result } = lookup([
        { id: 1, status: 'failed', ...ours },
        { id: 2, status: 'processed', ...ours },
      ]);
      expect(await result).toEqual({ status: 'completed', providerRefundId: '2', message: null });
      const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.test/refund?transaction=987&perPage=100');
      expect(init.method).toBe('GET');
    });

    it('reports one in progress, only-failed and none', async () => {
      expect(await lookup([{ id: 3, status: 'pending', ...ours }]).result).toMatchObject({
        status: 'processing',
        providerRefundId: '3',
      });
      expect(await lookup([{ id: 4, status: 'failed', ...ours }]).result).toMatchObject({
        status: 'failed',
      });
      expect(await lookup([]).result).toEqual({
        status: 'none',
        providerRefundId: null,
        message: null,
      });
    });

    it('adopts a refund that names this transaction (A)', async () => {
      expect(await lookup([{ id: 10, status: 'processed', ...ours }]).result).toMatchObject({
        status: 'completed',
        providerRefundId: '10',
      });
      // Either identifier alone is enough when the other is not available.
      expect(
        await lookup([{ id: 11, status: 'processed', transaction_reference: 'HHP-1' }], null)
          .result,
      ).toMatchObject({ status: 'completed', providerRefundId: '11' });
      expect(
        await lookup([{ id: 12, status: 'processed', transaction: '987' }]).result,
      ).toMatchObject({ status: 'completed', providerRefundId: '12' });
    });

    it('skips refunds of other transactions and keeps looking (B)', async () => {
      expect(
        await lookup([
          { id: 20, status: 'processed', ...other },
          { id: 21, status: 'processed', ...ours },
        ]).result,
      ).toMatchObject({ status: 'completed', providerRefundId: '21' });
      expect(
        await lookup([
          { id: 22, status: 'processed', ...other },
          { id: 23, status: 'pending', ...ours },
        ]).result,
      ).toMatchObject({ status: 'processing', providerRefundId: '23' });
    });

    it('reports none when no listed refund is for this transaction (C)', async () => {
      const none = { status: 'none', providerRefundId: null, message: null };
      expect(
        await lookup([
          { id: 30, status: 'processed', ...other },
          { id: 31, status: 'pending', ...other },
          { id: 32, status: 'failed', ...other },
        ]).result,
      ).toEqual(none);
      // One matching identifier is not enough if the other contradicts it.
      expect(
        await lookup([
          { id: 33, status: 'processed', transaction: 987, transaction_reference: 'HHP-OTHER' },
          { id: 34, status: 'processed', transaction: 555, transaction_reference: 'HHP-1' },
        ]).result,
      ).toEqual(none);
      // References are compared exactly.
      expect(
        await lookup([{ id: 35, status: 'processed', transaction_reference: 'hhp-1' }]).result,
      ).toEqual(none);
    });

    it('treats an unreadable or unattributable listing as outcome unknown (D)', async () => {
      await unknownOutcome({ id: 40, status: 'processed', ...ours }); // not a list
      await unknownOutcome(null);
      await unknownOutcome(['refund']);
      await unknownOutcome([{ id: 41, status: 'processed' }]); // names no transaction
      await unknownOutcome([{ status: 'processed', ...ours }]); // no refund id
      await unknownOutcome([{ id: 42, ...ours }]); // no status
      await unknownOutcome([{ id: 43, status: 'processed', transaction: { id: 987 } }]);
      await unknownOutcome([{ id: 44, status: 'processed', transaction: 987.5 }]);
      await unknownOutcome([{ id: 49, status: 'processed', transaction: '0987' }]);
      await unknownOutcome([{ id: 45, status: 'processed', transaction_reference: 7 }]);
      // Only a transaction id, and the payment has none to compare with.
      await unknownOutcome([{ id: 46, status: 'processed', transaction: 987 }], null);
      // A matching refund does not excuse an unreadable one beside it.
      await unknownOutcome([{ id: 47, status: 'processed', ...ours }, { id: 48 }]);
    });
  });
});

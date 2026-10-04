import { describe, expect, it, vi } from 'vitest';

import { networkError } from './errors';
import { fetchApiJson, SERVER_API_TIMEOUT_MS } from './fetch-json';

const json = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

describe('fetchApiJson', () => {
  it('returns the API envelope and passes a timeout signal', async () => {
    const fetchImpl = json(200, { success: true, data: { id: 1 } });
    const res = await fetchApiJson('http://api/x', { cache: 'no-store' }, { fetchImpl });
    expect(res).toEqual({ success: true, data: { id: 1 } });
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(init.cache).toBe('no-store');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(SERVER_API_TIMEOUT_MS).toBe(15_000);
  });

  it('passes API error responses through unchanged', async () => {
    const error = { success: false, code: 'NOT_FOUND', message: 'Booking not found.' };
    expect(await fetchApiJson('http://api/x', {}, { fetchImpl: json(404, error) })).toEqual(error);
  });

  it('gives up after the timeout instead of hanging', async () => {
    // A fetch that never answers until it is aborted.
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const started = Date.now();
    const res = await fetchApiJson(
      'http://api/slow',
      {},
      {
        timeoutMs: 50,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );
    expect(res).toBe(networkError);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('turns an unreachable API or a non-API answer into the network error', async () => {
    const down = vi
      .fn()
      .mockRejectedValue(new TypeError('fetch failed: ECONNREFUSED 10.0.0.5:4000'));
    expect(await fetchApiJson('http://api/x', {}, { fetchImpl: down })).toBe(networkError);
    const html = vi
      .fn()
      .mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 }));
    expect(await fetchApiJson('http://api/x', {}, { fetchImpl: html })).toBe(networkError);
    expect(
      await fetchApiJson('http://api/x', {}, { fetchImpl: json(200, { unexpected: true }) }),
    ).toBe(networkError);
    // Nothing from the failure (internal address, proxy page) reaches the page.
    expect(JSON.stringify(networkError)).not.toMatch(/10\.0\.0\.5|ECONNREFUSED|502|html/i);
  });
});

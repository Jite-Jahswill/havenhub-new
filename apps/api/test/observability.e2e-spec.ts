import { Logger } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MailService } from '../src/infrastructure/mail/mail.service';
import { AmenitiesService } from '../src/modules/amenities/amenities.service';
import { BookingMaintenanceService } from '../src/modules/bookings/booking-maintenance.service';
import { createAgent, createTestContext, PASSWORD, type TestContext } from './helpers/test-app';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());
afterEach(() => vi.restoreAllMocks());

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Entry = { level: string; message: string; fields: Record<string, unknown> };

/** Captures every log call (message + structured fields) made through Nest loggers. */
function captureLogs() {
  const entries: Entry[] = [];
  for (const level of ['log', 'warn', 'error'] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation((message: unknown, fields?: unknown) => {
      entries.push({
        level,
        message: String(message),
        fields: typeof fields === 'object' && fields ? (fields as Record<string, unknown>) : {},
      });
    });
  }
  const events = (event: string) => entries.filter((e) => e.fields.event === event);
  /** Everything that was logged, for "this secret never appears" checks. */
  const dump = () => JSON.stringify(entries);
  return { entries, events, dump };
}

describe('request ids', () => {
  it('generates one when absent and echoes it', async () => {
    const res = await ctx.http().get('/api/v1/amenities').expect(200);
    expect(res.headers['x-request-id']).toMatch(UUID);
    const other = await ctx.http().get('/api/v1/amenities').expect(200);
    expect(other.headers['x-request-id']).not.toBe(res.headers['x-request-id']);
  });

  it('keeps a well-formed incoming id and replaces a malformed one', async () => {
    const kept = await ctx.http().get('/api/v1/amenities').set('X-Request-Id', 'web-req-0001-abc');
    expect(kept.headers['x-request-id']).toBe('web-req-0001-abc');
    for (const bad of ['bad id', 'x'.repeat(200), '"><script>', 'Bearer abc.def']) {
      const res = await ctx.http().get('/api/v1/amenities').set('X-Request-Id', bad);
      expect(res.headers['x-request-id'], bad).toMatch(UUID);
    }
  });

  it('is on error responses too', async () => {
    const res = await ctx
      .http()
      .get('/api/v1/agents/me/properties')
      .set('X-Request-Id', 'err-req-00001');
    expect(res.status).toBe(401);
    expect(res.headers['x-request-id']).toBe('err-req-00001');
  });
});

describe('unexpected errors', () => {
  it('stay generic for the client and carry full context in the logs — but no secrets', async () => {
    vi.spyOn(ctx.app.get(AmenitiesService), 'listActive').mockRejectedValue(
      new Error('boom while reading amenities'),
    );
    const logs = captureLogs();
    const res = await ctx
      .http()
      .get('/api/v1/amenities?token=query-secret-123')
      .set('X-Request-Id', 'trace-500-abcdef')
      .set('Authorization', 'Bearer header-secret-456')
      .set('Cookie', 'hh_at=cookie-secret-789');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/boom|stack|at /);
    expect(res.headers['x-request-id']).toBe('trace-500-abcdef');

    const [error] = logs.events('http.unhandled_error');
    expect(error).toMatchObject({ level: 'error' });
    expect(error!.fields).toMatchObject({
      requestId: 'trace-500-abcdef',
      method: 'GET',
      path: '/api/v1/amenities',
      errorName: 'Error',
      errorMessage: 'boom while reading amenities',
    });
    expect(String(error!.fields.stack)).toMatch(/at /);

    // The completed request is summarised once with route, status and duration.
    await vi.waitFor(() => expect(logs.events('http.request.failed')).toHaveLength(1));
    expect(logs.events('http.request.failed')[0]!.fields).toMatchObject({
      requestId: 'trace-500-abcdef',
      method: 'GET',
      route: '/api/v1/amenities',
      path: '/api/v1/amenities',
      status: 500,
    });
    expect(typeof logs.events('http.request.failed')[0]!.fields.durationMs).toBe('number');

    for (const secret of ['query-secret-123', 'header-secret-456', 'cookie-secret-789', '?token']) {
      expect(logs.dump()).not.toContain(secret);
    }
  });

  it('successful requests stay quiet', async () => {
    const logs = captureLogs();
    await ctx.http().get('/api/v1/amenities').expect(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(logs.entries).toEqual([]);
  });
});

describe('operational events', () => {
  it('failed sign-ins are logged without the email or password', async () => {
    const agent = await createAgent(ctx);
    const logs = captureLogs();
    for (const body of [
      { email: agent.email, password: 'wrong-password-secret-1' },
      { email: 'nobody-secret@example.com', password: PASSWORD },
    ]) {
      await ctx
        .http()
        .post('/api/v1/auth/login')
        .set('X-Auth-Mode', 'token')
        .send(body)
        .expect(401);
    }
    const failed = logs.events('auth.login_failed');
    expect(failed).toHaveLength(2);
    expect(failed.map((e) => e.level)).toEqual(['warn', 'warn']);
    expect(failed[0]!.fields).toMatchObject({ reason: 'invalid_credentials', clientType: 'TOKEN' });
    for (const secret of ['wrong-password-secret-1', PASSWORD, agent.email, 'nobody-secret']) {
      expect(logs.dump()).not.toContain(secret);
    }
  });

  it('a rejected webhook is logged without its signature or body', async () => {
    const logs = captureLogs();
    const body = JSON.stringify({ event: 'charge.success', data: { reference: 'HHP-secret-ref' } });
    await ctx
      .http()
      .post('/api/v1/payments/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', 'f'.repeat(128))
      .send(body)
      .expect(401);
    const [rejected] = logs.events('webhook.invalid_signature');
    expect(rejected).toMatchObject({ level: 'warn' });
    expect(rejected!.fields).toMatchObject({ provider: 'paystack' });
    expect(logs.dump()).not.toContain('f'.repeat(32));
    expect(logs.dump()).not.toContain('HHP-secret-ref');
  });

  it('a failing background job is logged with its name and run id', async () => {
    const sweep = ctx.app.get(BookingMaintenanceService);
    vi.spyOn(sweep, 'runOnce').mockRejectedValue(new Error('sweep exploded'));
    const logs = captureLogs();
    await (sweep as unknown as { tick(): Promise<void> }).tick();
    const [failed] = logs.events('job.failed');
    expect(failed).toMatchObject({ level: 'error' });
    expect(failed!.fields).toMatchObject({
      job: 'bookings.sweep',
      errorName: 'Error',
      errorMessage: 'sweep exploded',
    });
    expect(failed!.fields.runId).toMatch(UUID);
  });

  it('a failed email is logged with its code — never the recipient, subject or server reply', async () => {
    vi.spyOn(ctx.mail, 'send').mockRejectedValue(
      Object.assign(new Error('550 5.1.1 <victim@example.com>: Recipient address rejected'), {
        code: 'EENVELOPE',
      }),
    );
    const logs = captureLogs();
    await ctx.app.get(MailService).send({
      to: 'victim@example.com',
      subject: 'Reset your password (secret-subject)',
      text: 'token=reset-secret',
      html: '<p>token=reset-secret</p>',
    });
    const [failed] = logs.events('mail.send_failed');
    expect(failed).toMatchObject({ level: 'error' });
    expect(failed!.fields).toMatchObject({
      transport: 'memory',
      errorName: 'Error',
      errorCode: 'EENVELOPE',
    });
    for (const secret of ['victim@example.com', 'secret-subject', 'reset-secret', '550']) {
      expect(logs.dump()).not.toContain(secret);
    }
  });

  it('exceeded rate limits are logged by rule, without the caller identity', async () => {
    const limited = await createTestContext({ RATE_LIMIT_ENABLED: true });
    try {
      await limited.reset();
      const logs = captureLogs();
      for (let i = 0; i < 11; i++) {
        await limited
          .http()
          .post('/api/v1/auth/register/customer')
          .send({ email: 'limit-secret@example.com' });
      }
      const [exceeded] = logs.events('rate_limit.exceeded');
      expect(exceeded).toMatchObject({ level: 'warn' });
      expect(exceeded!.fields).toMatchObject({
        rule: 'register:ip',
        by: 'ip',
        method: 'POST',
        path: '/api/v1/auth/register/customer',
      });
      expect(logs.dump()).not.toMatch(/127\.0\.0\.1|limit-secret/);
    } finally {
      await limited.reset();
      await limited.close();
    }
  });
});

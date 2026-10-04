import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { createTestContext, type TestContext } from './helpers/test-app';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

/** Runs the global filter on an error and captures the response and log lines. */
function filter(error: unknown, url = '/api/v1/things?token=secret-token') {
  const res = { statusCode: 0, body: undefined } as {
    statusCode: number;
    body: unknown;
    status(code: number): typeof res;
    json(body: unknown): void;
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ method: 'POST', originalUrl: url, requestId: 'req-test-1234' }),
    }),
  };
  const logs: { message: string; fields: Record<string, unknown> }[] = [];
  const record = (m: unknown, fields?: unknown) => {
    logs.push({ message: String(m), fields: (fields ?? {}) as Record<string, unknown> });
  };
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(record);
  const error_ = vi.spyOn(Logger.prototype, 'error').mockImplementation(record);
  try {
    new HttpExceptionFilter().catch(error, host as never);
  } finally {
    warn.mockRestore();
    error_.mockRestore();
  }
  return { status: res.statusCode, body: res.body as Record<string, unknown>, logs };
}

/** Real errors from the real database, not hand-built shapes. */
async function caught(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected an error');
}

describe('error mapping', () => {
  it('maps unique and exclusion conflicts (ORM and raw) to 409 with a generic message', async () => {
    const role = await ctx.prisma.role.findFirstOrThrow();
    const orm = await caught(() => ctx.prisma.role.create({ data: { key: role.key, name: 'x' } }));
    const raw = await caught(
      () =>
        ctx.prisma
          .$executeRaw`INSERT INTO roles (id, key, name, updated_at) VALUES (gen_random_uuid(), ${role.key}, 'x', now())`,
    );
    for (const error of [orm, raw]) {
      const out = filter(error);
      expect(out.status).toBe(409);
      expect(out.body).toEqual({
        success: false,
        code: 'CONFLICT',
        message: 'This conflicts with an existing record. Please refresh and try again.',
      });
      // Constraint names, values and query text never reach the client.
      expect(JSON.stringify(out.body)).not.toMatch(/roles_key|duplicate|INSERT/);
      expect(out.logs).toHaveLength(1);
      expect(out.logs[0]!.fields).toMatchObject({
        event: 'http.database_error',
        kind: 'conflict',
        requestId: 'req-test-1234',
        method: 'POST',
        path: '/api/v1/things',
      });
      expect(String(out.logs[0]!.fields.code)).toMatch(/^P20(02|10)/);
      // No query string, SQL, values or constraint contents.
      expect(JSON.stringify(out.logs)).not.toMatch(
        /secret-token|roles_key|duplicate|INSERT|VALUES/,
      );
    }
  });

  it('maps a missing record to 404', async () => {
    const error = await caught(() =>
      ctx.prisma.role.update({
        where: { id: '00000000-0000-4000-8000-000000000000' },
        data: { name: 'x' },
      }),
    );
    const out = filter(error);
    expect(out.status).toBe(404);
    expect(out.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('maps a real deadlock (ORM and raw) to a retryable 503', async () => {
    const [a, b] = await ctx.prisma.role.findMany({ take: 2, orderBy: { key: 'asc' } });
    const pause = () => new Promise((r) => setTimeout(r, 300));
    const raw = (first: string, second: string) =>
      ctx.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM roles WHERE id = ${first}::uuid FOR UPDATE`;
        await pause();
        await tx.$queryRaw`SELECT id FROM roles WHERE id = ${second}::uuid FOR UPDATE`;
      });
    const orm = (first: string, second: string) =>
      ctx.prisma.$transaction(async (tx) => {
        await tx.role.update({ where: { id: first }, data: { updatedAt: new Date() } });
        await pause();
        await tx.role.update({ where: { id: second }, data: { updatedAt: new Date() } });
      });
    for (const run of [raw, orm]) {
      const results = await Promise.allSettled([run(a!.id, b!.id), run(b!.id, a!.id)]);
      const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(failure, 'one transaction must lose the deadlock').toBeDefined();
      const out = filter(failure.reason);
      expect(out.status).toBe(503);
      expect(out.body).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    }
  });

  it('keeps unexpected errors generic, logged with method and path but no query string', () => {
    const out = filter(new Error('boom: internal detail'));
    expect(out.status).toBe(500);
    expect(out.body).toEqual({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
    });
    expect(out.logs[0]!.fields).toMatchObject({
      event: 'http.unhandled_error',
      requestId: 'req-test-1234',
      method: 'POST',
      path: '/api/v1/things',
      errorName: 'Error',
      errorMessage: 'boom: internal detail',
    });
    expect(String(out.logs[0]!.fields.stack)).toMatch(/^\s+at /);
    expect(JSON.stringify(out.logs)).not.toContain('secret-token');
  });

  it('leaves application errors unchanged', () => {
    const out = filter(
      new HttpException({ message: 'Nope', code: 'FORBIDDEN' }, HttpStatus.FORBIDDEN),
    );
    expect(out.status).toBe(403);
    expect(out.body).toEqual({ success: false, message: 'Nope', code: 'FORBIDDEN' });
    expect(out.logs).toEqual([]);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestContext, type TestContext } from './helpers/test-app';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

const INDEXES = {
  payments_paid_at_idx: ['payments', 'paid_at'],
  subscription_payments_paid_at_idx: ['subscription_payments', 'paid_at'],
  refunds_completed_at_idx: ['refunds', 'completed_at'],
  sessions_last_used_at_idx: ['sessions', 'last_used_at'],
} as const;

/** The plan Postgres picks once sequential scans are ruled out (test tables are tiny). */
async function plan(sql: string): Promise<string> {
  return ctx.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
    const rows = await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN ${sql}`);
    return rows.map((r) => r['QUERY PLAN']).join('\n');
  });
}

describe('date-range indexes (Phase 9 B4)', () => {
  it('exist as plain single-column b-tree indexes', async () => {
    const rows = await ctx.prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE indexname IN ('payments_paid_at_idx', 'subscription_payments_paid_at_idx',
                          'refunds_completed_at_idx', 'sessions_last_used_at_idx')`;
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      const [table, column] = INDEXES[row.indexname as keyof typeof INDEXES];
      expect(row.indexdef).toBe(
        `CREATE INDEX ${row.indexname} ON public.${table} USING btree (${column})`,
      );
    }
  });

  it('serve the date-range predicates of the analytics queries', async () => {
    // Which index wins for the full queries depends on table statistics (empty
    // here); this proves each new index answers its range predicate.
    const cases: [string, string][] = [
      [
        `SELECT sum(amount_kobo) FROM payments WHERE paid_at >= '2026-09-01T00:00:00Z' AND paid_at < '2026-10-01T00:00:00Z'`,
        'payments_paid_at_idx',
      ],
      [
        `SELECT sum(amount_kobo) FROM subscription_payments WHERE paid_at >= '2026-09-01T00:00:00Z' AND paid_at < '2026-10-01T00:00:00Z'`,
        'subscription_payments_paid_at_idx',
      ],
      [
        `SELECT sum(amount_kobo) FROM refunds WHERE completed_at >= '2026-09-01T00:00:00Z' AND completed_at < '2026-10-01T00:00:00Z'`,
        'refunds_completed_at_idx',
      ],
      [
        `SELECT count(DISTINCT user_id) FROM sessions WHERE created_at < '2026-10-01T00:00:00Z' AND last_used_at >= '2026-09-01T00:00:00Z'`,
        'sessions_last_used_at_idx',
      ],
    ];
    for (const [sql, index] of cases) {
      expect(await plan(sql), index).toContain(index);
    }
  });
});

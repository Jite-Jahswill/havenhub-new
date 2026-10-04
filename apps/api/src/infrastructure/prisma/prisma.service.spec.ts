import { describe, expect, it } from 'vitest';

import { poolConfig } from './prisma.service';

const url = 'postgresql://u:p@localhost:5432/db';

describe('poolConfig', () => {
  it('passes only the connection string by default (driver defaults unchanged)', () => {
    expect(poolConfig({ DATABASE_URL: url })).toEqual({ connectionString: url });
  });

  it('applies the optional limits when configured', () => {
    expect(
      poolConfig({
        DATABASE_URL: url,
        DATABASE_POOL_MAX: 12,
        DATABASE_STATEMENT_TIMEOUT_MS: 30_000,
        DATABASE_CONNECT_TIMEOUT_MS: 5_000,
      }),
    ).toEqual({
      connectionString: url,
      max: 12,
      statement_timeout: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  });
});

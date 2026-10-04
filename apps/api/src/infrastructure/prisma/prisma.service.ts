import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PoolConfig } from 'pg';

import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaClient } from '../../generated/prisma/client';

/**
 * pg pool settings. Optional limits apply only when configured, so the
 * defaults are exactly the driver's own.
 */
export function poolConfig(
  env: Pick<
    Env,
    | 'DATABASE_URL'
    | 'DATABASE_POOL_MAX'
    | 'DATABASE_STATEMENT_TIMEOUT_MS'
    | 'DATABASE_CONNECT_TIMEOUT_MS'
  >,
): PoolConfig {
  return {
    connectionString: env.DATABASE_URL,
    ...(env.DATABASE_POOL_MAX !== undefined ? { max: env.DATABASE_POOL_MAX } : {}),
    ...(env.DATABASE_STATEMENT_TIMEOUT_MS !== undefined
      ? { statement_timeout: env.DATABASE_STATEMENT_TIMEOUT_MS }
      : {}),
    ...(env.DATABASE_CONNECT_TIMEOUT_MS !== undefined
      ? { connectionTimeoutMillis: env.DATABASE_CONNECT_TIMEOUT_MS }
      : {}),
  };
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super({ adapter: new PrismaPg(poolConfig(env)) });
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

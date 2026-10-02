import { Injectable } from '@nestjs/common';
import type { DependencyStatus, HealthCheck } from '@havenhub/shared';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';

const toStatus = (healthy: boolean): DependencyStatus => (healthy ? 'up' : 'down');

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async check(): Promise<HealthCheck> {
    const [database, redis] = await Promise.all([this.prisma.isHealthy(), this.redis.isHealthy()]);

    return {
      status: database && redis ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? '0.0.0',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      checks: { database: toStatus(database), redis: toStatus(redis) },
    };
  }
}

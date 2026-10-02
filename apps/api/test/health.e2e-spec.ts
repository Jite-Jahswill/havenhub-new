import { Global, Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { healthCheckSchema } from '@havenhub/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { ENV } from '../src/config/config.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { RedisService } from '../src/infrastructure/redis/redis.service';
import { HealthModule } from '../src/modules/health/health.module';
import { setupApp } from '../src/setup-app';

async function createApp(deps: { database: boolean; redis: boolean }): Promise<INestApplication> {
  @Global()
  @Module({
    providers: [
      { provide: ENV, useValue: { CORS_ORIGINS: [] } },
      { provide: PrismaService, useValue: { isHealthy: () => Promise.resolve(deps.database) } },
      { provide: RedisService, useValue: { isHealthy: () => Promise.resolve(deps.redis) } },
    ],
    exports: [ENV, PrismaService, RedisService],
  })
  class FakeInfrastructureModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [FakeInfrastructureModule, HealthModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  setupApp(app, { CORS_ORIGINS: [] });
  await app.init();
  return app;
}

describe('Health (e2e)', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it('GET /api/health/live returns ok', async () => {
    app = await createApp({ database: true, redis: true });
    const res = await request(app.getHttpServer()).get('/api/health/live').expect(200);
    expect(res.body).toEqual({ success: true, data: { status: 'ok' } });
  });

  it('GET /api/health returns 200 when all dependencies are up', async () => {
    app = await createApp({ database: true, redis: true });
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    const health = healthCheckSchema.parse(res.body.data);
    expect(health.status).toBe('ok');
    expect(health.checks).toEqual({ database: 'up', redis: 'up' });
  });

  it('GET /api/health returns 503 when a dependency is down', async () => {
    app = await createApp({ database: true, redis: false });
    const res = await request(app.getHttpServer()).get('/api/health').expect(503);
    expect(res.body.data.status).toBe('degraded');
    expect(res.body.data.checks.redis).toBe('down');
  });

  it('unknown routes use the shared error envelope', async () => {
    app = await createApp({ database: true, redis: true });
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    expect(res.body).toMatchObject({ success: false, code: 'NOT_FOUND' });
  });
});

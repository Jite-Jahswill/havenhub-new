import { VersioningType, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import type { Env } from './config/env';

/**
 * Applies global HTTP configuration. Shared by `main.ts` and e2e tests so
 * tests exercise the same routing, versioning and error handling.
 *
 * Routes: /api/v1/<resource>  (health checks are version-neutral: /api/health)
 */
export function setupApp(
  app: INestApplication,
  env: Pick<Env, 'CORS_ORIGINS'> & Partial<Pick<Env, 'trustProxy'>>,
): void {
  const express = app as NestExpressApplication;
  // Needed for correct client IPs (rate limiting, audit) behind Railway/Vercel proxies.
  express.set('trust proxy', env.trustProxy ?? 'loopback');
  express.disable('x-powered-by');
  express.useBodyParser('json', { limit: '100kb' });

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: true });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
}

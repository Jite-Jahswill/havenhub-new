import 'reflect-metadata';

import { resolve } from 'node:path';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config as loadDotenv } from 'dotenv';

import { AppModule } from './app.module';
import { ENV } from './config/config.module';
import type { Env } from './config/env';
import { setupApp } from './setup-app';

// Local development reads the monorepo root .env. In production the platform
// injects real environment variables, which always take precedence.
loadDotenv({ path: resolve(__dirname, '../../../.env'), quiet: true });

async function bootstrap(): Promise<void> {
  // rawBody: payment webhooks are authenticated by a signature over the exact bytes.
  const app = await NestFactory.create(AppModule, { bodyParser: false, rawBody: true });
  const env = app.get<Env>(ENV);
  setupApp(app, env);

  await app.listen(env.port, '0.0.0.0');
  Logger.log(`HavenHub API listening on port ${env.port} (prefix /api)`, 'Bootstrap');
}

void bootstrap();

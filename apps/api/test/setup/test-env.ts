import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';

/**
 * Integration tests run against a dedicated database (`<name>_test`) and
 * Redis logical DB 15, never the development data. Override with
 * TEST_DATABASE_URL / TEST_REDIS_URL (CI does).
 */
export function resolveTestEnv(): Record<string, string> {
  loadDotenv({ path: resolve(__dirname, '../../../../.env'), quiet: true });

  const databaseUrl =
    process.env.TEST_DATABASE_URL ?? deriveTestDatabaseUrl(requireEnv('DATABASE_URL'));
  const redisUrl = process.env.TEST_REDIS_URL ?? deriveTestRedisUrl(requireEnv('REDIS_URL'));

  return {
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    WEB_APP_URL: 'http://localhost:3000',
    CORS_ORIGINS: 'http://localhost:3000',
    RATE_LIMIT_ENABLED: 'false',
    REQUIRE_EMAIL_VERIFICATION: 'true',
    FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString('base64'),
    AUTH_SECRET: Buffer.alloc(32, 12).toString('base64'),
    SMTP_HOST: '',
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: join(tmpdir(), 'havenhub-test-uploads'),
    STORAGE_PUBLIC_BASE_URL: '/api/media',
    PAYMENT_PROVIDER: 'test',
    PAYSTACK_SECRET_KEY: 'sk_test_havenhub_webhook_secret',
    BOOKING_SWEEP_INTERVAL_SECONDS: '0',
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set to run integration tests`);
  return value;
}

function deriveTestDatabaseUrl(url: string): string {
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, '') || 'havenhub';
  parsed.pathname = `/${name.endsWith('_test') ? name : `${name}_test`}`;
  return parsed.toString();
}

function deriveTestRedisUrl(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = '/15';
  return parsed.toString();
}

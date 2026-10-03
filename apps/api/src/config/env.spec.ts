import { describe, expect, it } from 'vitest';

import { loadEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  AUTH_SECRET: Buffer.alloc(32, 2).toString('base64'),
};

const productionExtras = {
  NODE_ENV: 'production',
  SMTP_HOST: 'smtp.example.com',
  STORAGE_DRIVER: 's3',
  STORAGE_BUCKET: 'havenhub',
  STORAGE_ACCESS_KEY: 'key',
  STORAGE_SECRET_KEY: 'secret',
  PAYMENT_PROVIDER: 'paystack',
  PAYSTACK_SECRET_KEY: 'sk_live_example',
};

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv(valid);
    expect(env.port).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000']);
    expect(env.REQUIRE_EMAIL_VERIFICATION).toBe(true);
    expect(env.ACCESS_TOKEN_TTL_MINUTES).toBe(15);
    expect(env.cookieSecure).toBe(false);
  });

  it('prefers the platform-provided PORT', () => {
    expect(loadEnv({ ...valid, PORT: '8080' }).port).toBe(8080);
  });

  it('splits CORS origins', () => {
    const env = loadEnv({ ...valid, CORS_ORIGINS: 'https://a.ng, https://b.ng' });
    expect(env.CORS_ORIGINS).toEqual(['https://a.ng', 'https://b.ng']);
  });

  it('uses secure cookies in production', () => {
    const env = loadEnv({ ...valid, ...productionExtras });
    expect(env.cookieSecure).toBe(true);
  });

  it('refuses the simulated payment provider in production', () => {
    expect(() => loadEnv({ ...valid, ...productionExtras, PAYMENT_PROVIDER: 'test' })).toThrow(
      /PAYMENT_PROVIDER/,
    );
  });

  it('requires a Paystack secret key when Paystack is the provider', () => {
    expect(() => loadEnv({ ...valid, PAYMENT_PROVIDER: 'paystack' })).toThrow(
      /PAYSTACK_SECRET_KEY/,
    );
    expect(loadEnv(valid).PAYMENT_PROVIDER).toBe('test');
  });

  it('lets production start without SMTP_HOST (admin SMTP settings are checked at startup)', () => {
    expect(() => loadEnv({ ...valid, ...productionExtras, SMTP_HOST: undefined })).not.toThrow();
  });

  it('refuses local disk storage in production', () => {
    expect(() => loadEnv({ ...valid, ...productionExtras, STORAGE_DRIVER: 'local' })).toThrow(
      /STORAGE_DRIVER/,
    );
  });

  it('requires bucket credentials for s3 storage', () => {
    expect(() => loadEnv({ ...valid, STORAGE_DRIVER: 's3' })).toThrow(/STORAGE_BUCKET/);
  });

  it('rejects a missing database URL', () => {
    const { DATABASE_URL: _omit, ...rest } = valid;
    expect(() => loadEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-postgres database URL', () => {
    expect(() => loadEnv({ ...valid, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects an encryption key of the wrong length', () => {
    expect(() =>
      loadEnv({ ...valid, FIELD_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
    ).toThrow(/FIELD_ENCRYPTION_KEY/);
  });

  it('parses boolean flags and trust proxy hop counts', () => {
    const env = loadEnv({ ...valid, REQUIRE_EMAIL_VERIFICATION: 'false', TRUST_PROXY: '1' });
    expect(env.REQUIRE_EMAIL_VERIFICATION).toBe(false);
    expect(env.trustProxy).toBe(1);
  });
});

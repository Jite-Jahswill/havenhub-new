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
  STORAGE_PUBLIC_BASE_URL: 'https://media.example.com',
  PAYMENT_PROVIDER: 'paystack',
  PAYSTACK_SECRET_KEY: 'sk_live_example',
  WEB_APP_URL: 'https://havenhub.ng',
  CORS_ORIGINS: 'https://havenhub.ng',
  TRUST_PROXY: '1',
  INTERNAL_API_SECRET: 'internal-secret-for-tests-0123456789abcdef',
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

  it('defaults trust proxy to loopback outside production', () => {
    expect(loadEnv(valid).trustProxy).toBe('loopback');
  });

  it('accepts a complete production configuration', () => {
    const env = loadEnv({ ...valid, ...productionExtras });
    expect(env.trustProxy).toBe(1);
    expect(env.WEB_APP_URL).toBe('https://havenhub.ng');
  });

  describe('production guardrails', () => {
    const prod = (overrides: Record<string, string | undefined>) => () =>
      loadEnv({ ...valid, ...productionExtras, ...overrides });

    it('refuses localhost or plain-http public URLs', () => {
      expect(prod({ WEB_APP_URL: undefined })).toThrow(/WEB_APP_URL.*localhost/);
      expect(prod({ WEB_APP_URL: 'http://havenhub.ng' })).toThrow(/WEB_APP_URL.*https/);
      expect(prod({ WEB_INTERNAL_URL: 'http://localhost:3000' })).toThrow(/WEB_INTERNAL_URL/);
    });

    it('refuses localhost, plain-http or missing CORS origins', () => {
      expect(prod({ CORS_ORIGINS: undefined })).toThrow(/CORS_ORIGINS.*localhost/);
      expect(prod({ CORS_ORIGINS: 'https://havenhub.ng,http://evil.example' })).toThrow(
        /CORS_ORIGINS.*https/,
      );
      expect(prod({ CORS_ORIGINS: ' , ' })).toThrow(/CORS_ORIGINS: Required in production/);
    });

    it('requires an explicit trust-proxy setting that is not "trust everything"', () => {
      expect(prod({ TRUST_PROXY: undefined })).toThrow(/TRUST_PROXY: Set explicitly/);
      expect(prod({ TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY: Trusting every proxy/);
      expect(prod({ TRUST_PROXY: '10.0.0.0/8' })).not.toThrow();
    });

    it('requires the internal secret shared with the web server', () => {
      expect(prod({ INTERNAL_API_SECRET: undefined })).toThrow(/INTERNAL_API_SECRET: Required/);
      expect(prod({ INTERNAL_API_SECRET: '' })).toThrow(/INTERNAL_API_SECRET: Required/);
      expect(prod({ INTERNAL_API_SECRET: 'too-short' })).toThrow(/INTERNAL_API_SECRET/);
    });

    it('refuses insecure cookies', () => {
      expect(prod({ COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
      expect(prod({ COOKIE_SECURE: 'true' })).not.toThrow();
    });

    it('requires a live Paystack key, without echoing the key', () => {
      for (const key of ['sk_test_0123456789abcdef', 'pk_live_0123456789', 'live-key-0123']) {
        let message = '';
        try {
          loadEnv({ ...valid, ...productionExtras, PAYSTACK_SECRET_KEY: key });
        } catch (error) {
          message = (error as Error).message;
        }
        expect(message).toMatch(/PAYSTACK_SECRET_KEY: Production requires a live Paystack/);
        expect(message).not.toContain(key);
      }
      expect(prod({ PAYSTACK_SECRET_KEY: 'sk_live_0123456789abcdef' })).not.toThrow();
      // Test keys stay usable outside production.
      expect(() =>
        loadEnv({ ...valid, PAYMENT_PROVIDER: 'paystack', PAYSTACK_SECRET_KEY: 'sk_test_x' }),
      ).not.toThrow();
    });

    it('requires the public https bucket/CDN URL for s3 storage', () => {
      for (const url of [
        undefined,
        '/api/media',
        'http://media.example.com',
        'https://localhost/m',
      ]) {
        expect(prod({ STORAGE_PUBLIC_BASE_URL: url }), String(url)).toThrow(
          /STORAGE_PUBLIC_BASE_URL: .*set the bucket or CDN URL/,
        );
      }
      expect(prod({ STORAGE_PUBLIC_BASE_URL: 'https://cdn.example.com/media/' })).not.toThrow();
      expect(prod({ STORAGE_PUBLIC_BASE_URL: 'https://bucket.s3.example.com' })).not.toThrow();
      // Development keeps the local default.
      expect(loadEnv(valid).STORAGE_PUBLIC_BASE_URL).toBe('/api/media');
      expect(() =>
        loadEnv({
          ...valid,
          STORAGE_DRIVER: 's3',
          STORAGE_BUCKET: 'b',
          STORAGE_ACCESS_KEY: 'k',
          STORAGE_SECRET_KEY: 's',
        }),
      ).not.toThrow();
    });

    it('does not apply to development or test', () => {
      expect(() =>
        loadEnv({ ...valid, NODE_ENV: 'test', COOKIE_SECURE: 'false', TRUST_PROXY: 'true' }),
      ).not.toThrow();
      expect(() => loadEnv({ ...valid, WEB_APP_URL: 'http://localhost:3000' })).not.toThrow();
    });
  });

  it('parses the optional database pool settings', () => {
    expect(loadEnv(valid).DATABASE_POOL_MAX).toBeUndefined();
    const env = loadEnv({
      ...valid,
      DATABASE_POOL_MAX: '15',
      DATABASE_STATEMENT_TIMEOUT_MS: '30000',
      DATABASE_CONNECT_TIMEOUT_MS: '5000',
    });
    expect(env).toMatchObject({
      DATABASE_POOL_MAX: 15,
      DATABASE_STATEMENT_TIMEOUT_MS: 30000,
      DATABASE_CONNECT_TIMEOUT_MS: 5000,
    });
    expect(() => loadEnv({ ...valid, DATABASE_POOL_MAX: '0' })).toThrow(/DATABASE_POOL_MAX/);
    expect(() => loadEnv({ ...valid, DATABASE_STATEMENT_TIMEOUT_MS: '5' })).toThrow(
      /DATABASE_STATEMENT_TIMEOUT_MS/,
    );
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CONTENT_SECURITY_POLICY,
  HSTS_VALUE,
  PAYSTACK_CHECKOUT_ORIGIN,
  securityHeaders,
} from './security-headers';

const byKey = (headers: { key: string; value: string }[]) =>
  Object.fromEntries(headers.map((h) => [h.key, h.value]));

describe('securityHeaders', () => {
  it('sends the conservative CSP and the existing headers everywhere', () => {
    for (const production of [true, false]) {
      const h = byKey(securityHeaders({ production, siteUrl: 'https://havenhub.ng' }));
      expect(h['Content-Security-Policy']).toBe(CONTENT_SECURITY_POLICY);
      expect(h['X-Content-Type-Options']).toBe('nosniff');
      expect(h['X-Frame-Options']).toBe('DENY');
      expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
      expect(h['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=(self)');
    }
  });

  it('restricts framing, plugins, <base> and form targets — and nothing else', () => {
    const directives = Object.fromEntries(
      CONTENT_SECURITY_POLICY.split('; ').map((d) => {
        const [name, ...values] = d.split(' ');
        return [name, values.join(' ')];
      }),
    );
    expect(directives).toEqual({
      'frame-ancestors': "'none'",
      'object-src': "'none'",
      'base-uri': "'self'",
      'form-action': `'self' ${PAYSTACK_CHECKOUT_ORIGIN}`,
    });
    // No script/style/connect/img policy yet: Next.js, fonts, maps and Socket.IO are untouched.
    expect(CONTENT_SECURITY_POLICY).not.toMatch(
      /script-src|style-src|connect-src|img-src|default-src/,
    );
    expect(PAYSTACK_CHECKOUT_ORIGIN).toBe('https://checkout.paystack.com');
  });

  it('adds HSTS only to production builds served over https', () => {
    expect(
      byKey(securityHeaders({ production: true, siteUrl: 'https://havenhub.ng' })),
    ).toHaveProperty('Strict-Transport-Security', HSTS_VALUE);
    for (const options of [
      { production: false, siteUrl: 'https://havenhub.ng' },
      { production: true, siteUrl: 'http://localhost:3000' },
      { production: false, siteUrl: 'http://localhost:3000' },
    ]) {
      expect(byKey(securityHeaders(options)), JSON.stringify(options)).not.toHaveProperty(
        'Strict-Transport-Security',
      );
    }
    expect(HSTS_VALUE).toBe('max-age=31536000');
  });
});

describe('next.config headers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function configHeaders(env: Record<string, string>) {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const config = (await import('../../next.config')).default;
    const rules = await config.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0]!.source).toBe('/:path*');
    return byKey(rules[0]!.headers);
  }

  it('applies the CSP to every path, with HSTS for an https production site', async () => {
    const h = await configHeaders({
      NODE_ENV: 'production',
      NEXT_PUBLIC_SITE_URL: 'https://havenhub.ng',
    });
    expect(h['Content-Security-Policy']).toBe(CONTENT_SECURITY_POLICY);
    expect(h['Strict-Transport-Security']).toBe(HSTS_VALUE);
  });

  it('never pins local development to https', async () => {
    const h = await configHeaders({
      NODE_ENV: 'development',
      NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
    });
    expect(h['Content-Security-Policy']).toBe(CONTENT_SECURITY_POLICY);
    expect(h).not.toHaveProperty('Strict-Transport-Security');
  });
});

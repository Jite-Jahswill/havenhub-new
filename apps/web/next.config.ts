import { unsafeProductionUrl } from '@havenhub/shared';
import type { NextConfig } from 'next';

import { securityHeaders } from './src/lib/security-headers';

const apiUrl = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, '');

// The /api rewrite destination is fixed at build time: a Vercel production
// build must not bake in a localhost or plain-http API (fail closed).
if (process.env.VERCEL_ENV === 'production') {
  for (const [key, value] of [
    ['API_INTERNAL_URL', apiUrl],
    ['NEXT_PUBLIC_SITE_URL', process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'],
  ] as const) {
    const problem = unsafeProductionUrl(value);
    if (problem) throw new Error(`Invalid ${key} for a production build: ${value} ${problem}`);
  }
}

const headers = securityHeaders({
  production: process.env.NODE_ENV === 'production',
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages shipped as TypeScript source.
  transpilePackages: ['@havenhub/ui'],
  headers: () => Promise.resolve([{ source: '/:path*', headers }]),
  // Same-origin API: the browser calls /api/*, Next.js forwards to the API.
  rewrites: () => Promise.resolve([{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }]),
};

export default nextConfig;

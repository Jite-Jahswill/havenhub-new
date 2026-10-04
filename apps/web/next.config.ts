import type { NextConfig } from 'next';

import { productionBuildProblems } from './src/lib/build-checks';
import { securityHeaders } from './src/lib/security-headers';

const apiUrl = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, '');

// The /api rewrite destination, the realtime URL and the map token are fixed
// at build time: a Vercel production build must not bake in localhost,
// plain-http or development fallbacks (fail closed).
if (process.env.VERCEL_ENV === 'production') {
  const problems = productionBuildProblems(process.env);
  if (problems.length) throw new Error(problems.join('\n'));
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

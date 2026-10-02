import type { NextConfig } from 'next';

const apiUrl = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, '');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages shipped as TypeScript source.
  transpilePackages: ['@havenhub/ui'],
  headers: () => Promise.resolve([{ source: '/:path*', headers: securityHeaders }]),
  // Same-origin API: the browser calls /api/*, Next.js forwards to the API.
  rewrites: () => Promise.resolve([{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }]),
};

export default nextConfig;

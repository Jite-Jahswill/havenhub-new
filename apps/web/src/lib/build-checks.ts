import { unsafeProductionUrl } from '@havenhub/shared';

/**
 * Values fixed at build time that a production build must not get wrong
 * (wired in next.config.ts for Vercel production builds). Each defaults to
 * its development value, so a missing one fails the check too:
 *  - API_INTERNAL_URL           the /api rewrite destination
 *  - NEXT_PUBLIC_SITE_URL       canonical URLs
 *  - NEXT_PUBLIC_REALTIME_URL   Socket.IO (else chat silently stops being live)
 *  - NEXT_PUBLIC_MAPBOX_TOKEN   map tiles (OpenStreetMap's are development only)
 * Returns the problems; empty when the build may proceed.
 */
export function productionBuildProblems(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  const urls = [
    ['API_INTERNAL_URL', env.API_INTERNAL_URL ?? 'http://localhost:4000'],
    ['NEXT_PUBLIC_SITE_URL', env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'],
    ['NEXT_PUBLIC_REALTIME_URL', env.NEXT_PUBLIC_REALTIME_URL ?? 'http://localhost:4000'],
  ] as const;
  for (const [key, value] of urls) {
    const problem = unsafeProductionUrl(value);
    if (problem) problems.push(`Invalid ${key} for a production build: ${value} ${problem}`);
  }
  if (!env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim()) {
    problems.push(
      'NEXT_PUBLIC_MAPBOX_TOKEN is required for a production build (OpenStreetMap tiles are for development only)',
    );
  }
  return problems;
}

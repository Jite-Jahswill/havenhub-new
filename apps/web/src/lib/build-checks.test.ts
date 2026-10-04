import { describe, expect, it } from 'vitest';

import { productionBuildProblems } from './build-checks';

const valid = {
  API_INTERNAL_URL: 'https://api.example.com',
  NEXT_PUBLIC_SITE_URL: 'https://example.com',
  NEXT_PUBLIC_REALTIME_URL: 'https://api.example.com',
  NEXT_PUBLIC_MAPBOX_TOKEN: 'pk.public-token',
};

describe('productionBuildProblems', () => {
  it('accepts a complete production configuration', () => {
    expect(productionBuildProblems(valid)).toEqual([]);
  });

  it('refuses a missing, localhost or plain-http realtime URL', () => {
    for (const value of [undefined, 'http://localhost:4000', 'http://api.example.com', 'nope']) {
      const problems = productionBuildProblems({ ...valid, NEXT_PUBLIC_REALTIME_URL: value });
      expect(problems, String(value)).toHaveLength(1);
      expect(problems[0]).toMatch(/^Invalid NEXT_PUBLIC_REALTIME_URL for a production build/);
    }
  });

  it('requires a Mapbox token instead of falling back to OpenStreetMap tiles', () => {
    for (const value of [undefined, '', '   ']) {
      expect(productionBuildProblems({ ...valid, NEXT_PUBLIC_MAPBOX_TOKEN: value })).toEqual([
        expect.stringMatching(/^NEXT_PUBLIC_MAPBOX_TOKEN is required for a production build/),
      ]);
    }
  });

  it('keeps refusing development API and site URLs, and reports every problem', () => {
    const problems = productionBuildProblems({});
    expect(problems).toHaveLength(4);
    expect(problems.join('\n')).toMatch(/API_INTERNAL_URL.*NEXT_PUBLIC_SITE_URL/s);
    expect(
      productionBuildProblems({ ...valid, API_INTERNAL_URL: 'http://api.example.com' }),
    ).toEqual([expect.stringMatching(/^Invalid API_INTERNAL_URL/)]);
  });
});

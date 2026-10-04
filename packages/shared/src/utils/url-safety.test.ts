import { describe, expect, it } from 'vitest';

import { unsafeProductionUrl } from './url-safety.js';

describe('unsafeProductionUrl', () => {
  it('accepts public https URLs', () => {
    for (const url of [
      'https://havenhub.ng',
      'https://api.havenhub.ng/',
      'https://x.up.railway.app',
    ]) {
      expect(unsafeProductionUrl(url), url).toBeNull();
    }
  });

  it('rejects http, localhost, loopback and invalid values', () => {
    expect(unsafeProductionUrl('http://havenhub.ng')).toMatch(/https/);
    for (const url of [
      'https://localhost:3000',
      'https://app.localhost',
      'https://127.0.0.1',
      'https://127.1.2.3:4000',
      'https://[::1]:4000',
      'https://0.0.0.0',
    ]) {
      expect(unsafeProductionUrl(url), url).toMatch(/localhost/);
    }
    expect(unsafeProductionUrl('not a url')).toMatch(/valid/);
  });
});

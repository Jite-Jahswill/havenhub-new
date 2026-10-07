import { describe, expect, it } from 'vitest';

import { notificationListQuerySchema, sendBroadcastSchema } from './notification.js';

const base = { audience: 'ALL', title: 'Hello there', body: 'News' };

describe('notification schemas', () => {
  it('accept only links that are paths on this site', () => {
    for (const link of ['/properties', '/agent/subscription/plans', '/blog?tag=lagos']) {
      expect(sendBroadcastSchema.parse({ ...base, link }).link).toBe(link);
    }
    for (const link of [
      'https://evil.example',
      '//evil.example',
      'javascript:alert(1)',
      'properties',
      '/\\evil.example',
      '/a b',
    ]) {
      expect(sendBroadcastSchema.safeParse({ ...base, link }).success, link).toBe(false);
    }
    expect(sendBroadcastSchema.parse({ ...base, link: '' }).link).toBeNull();
    expect(sendBroadcastSchema.parse(base).link).toBeNull();
  });

  it('require an email for one person, and a known audience', () => {
    expect(sendBroadcastSchema.safeParse({ ...base, audience: 'USER' }).success).toBe(false);
    expect(
      sendBroadcastSchema.safeParse({ ...base, audience: 'USER', email: 'ada@example.com' })
        .success,
    ).toBe(true);
    expect(sendBroadcastSchema.safeParse({ ...base, audience: 'ADMINS' }).success).toBe(false);
    expect(sendBroadcastSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });

  it('read the unread filter as a boolean', () => {
    expect(notificationListQuerySchema.parse({ unread: 'true' })).toMatchObject({
      unread: true,
      page: 1,
      pageSize: 20,
    });
    expect(notificationListQuerySchema.parse({}).unread).toBe(false);
  });
});

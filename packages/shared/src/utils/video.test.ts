import { describe, expect, it } from 'vitest';

import { parseVideoUrl, videoEmbedUrl } from './video.js';

describe('parseVideoUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'YOUTUBE', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?t=42', 'YOUTUBE', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'YOUTUBE', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'YOUTUBE', 'dQw4w9WgXcQ'],
    ['https://vimeo.com/76979871', 'VIMEO', '76979871'],
    ['https://player.vimeo.com/video/76979871', 'VIMEO', '76979871'],
  ])('parses %s', (url, provider, externalId) => {
    expect(parseVideoUrl(url)).toEqual({ provider, externalId });
  });

  it.each([
    'https://evil.example/watch?v=dQw4w9WgXcQ',
    'javascript:alert(1)',
    'https://youtube.com/watch?v=too-short',
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'not a url',
  ])('rejects %s', (url) => {
    expect(parseVideoUrl(url)).toBeNull();
  });

  it('builds privacy-friendly embed URLs from the id only', () => {
    expect(videoEmbedUrl({ provider: 'YOUTUBE', externalId: 'dQw4w9WgXcQ' })).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    );
    expect(videoEmbedUrl({ provider: 'VIMEO', externalId: '76979871' })).toBe(
      'https://player.vimeo.com/video/76979871',
    );
  });
});

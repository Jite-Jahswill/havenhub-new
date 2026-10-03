import { describe, expect, it } from 'vitest';

import {
  markdownImageSources,
  markdownToEmailHtml,
  markdownToText,
  parseMarkdown,
  readingMinutes,
} from './markdown.js';
import { isCmsImageSrc, isSafeHref } from './safe-url.js';

const opts = { mediaBase: '/api/media' };
const json = (src: string) => JSON.stringify(parseMarkdown(src, opts));

describe('isSafeHref', () => {
  it.each([
    'https://havenhub.ng/x',
    'http://example.com',
    '/properties?city=Lagos#map',
    '#section-2',
    'mailto:hello@havenhub.ng',
    'tel:+2348031234567',
  ])('allows %s', (href) => expect(isSafeHref(href)).toBe(true));

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'java​script:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '//evil.example/x',
    '/\\evil.example',
    'https://',
    'mailto:',
    '',
  ])('refuses %s', (href) => expect(isSafeHref(href)).toBe(false));
});

describe('isCmsImageSrc', () => {
  it('accepts only CMS images under the media base', () => {
    expect(isCmsImageSrc('/api/media/cms/media/abc-lg.webp', '/api/media')).toBe(true);
    expect(isCmsImageSrc('https://cdn.x/cms/media/abc-lg.webp', 'https://cdn.x/')).toBe(true);
    for (const src of [
      '/api/media/properties/abc/x-lg.webp',
      '/api/media/cms/../chat/x.webp',
      '/api/media/cms/x.svg',
      'https://evil.example/api/media/cms/x.webp',
      '/api/media/chat/x/y.webp',
      'javascript:alert(1)',
    ]) {
      expect(isCmsImageSrc(src, '/api/media'), src).toBe(false);
    }
  });
});

describe('parseMarkdown', () => {
  it('drops raw HTML, scripts and event handlers', () => {
    const out = json(
      '<script>alert(1)</script>\n\nHi <img src=x onerror=alert(1)> <b>bold</b>\n\n<iframe src="https://evil"></iframe>',
    );
    expect(out).not.toMatch(/script|onerror|iframe|<b>/);
    expect(out).toContain('Hi ');
  });

  it('keeps the words of unsafe links but not the link', () => {
    const nodes = parseMarkdown('[click](javascript:alert(1)) and [ok](https://havenhub.ng)', opts);
    expect(JSON.stringify(nodes)).not.toContain('javascript');
    expect(nodes[0]).toMatchObject({
      t: 'p',
      c: [
        { t: 'text', v: 'click and ' },
        { t: 'link', href: 'https://havenhub.ng' },
      ],
    });
  });

  it('only renders CMS images', () => {
    const out = json('![a](https://tracker.example/p.gif) ![b](/api/media/cms/media/x-lg.webp)');
    expect(out).not.toContain('tracker');
    expect(out).toContain('/api/media/cms/media/x-lg.webp');
  });

  it('supports headings (h1 demoted), lists, quotes, code and tables', () => {
    const nodes = parseMarkdown(
      '# Title\n\n1. one\n2. two\n\n> quote\n\n```\ncode <b>\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |',
      opts,
    );
    expect(nodes.map((n) => n.t)).toEqual(['h', 'ol', 'quote', 'pre', 'table']);
    expect(nodes[0]).toMatchObject({ level: 2 });
    expect(nodes[3]).toEqual({ t: 'pre', v: 'code <b>' });
  });

  it('survives deep nesting without unbounded recursion', () => {
    expect(() => parseMarkdown(`${'> '.repeat(200)}deep`, opts)).not.toThrow();
  });

  it('lists every image requested (for server checks)', () => {
    expect(markdownImageSources('![a](https://x/y.png)\n\n- ![b](/api/media/cms/z.webp)')).toEqual([
      'https://x/y.png',
      '/api/media/cms/z.webp',
    ]);
  });
});

describe('email rendering', () => {
  it('escapes everything and makes relative URLs absolute', () => {
    const nodes = parseMarkdown(
      'Hello "friends" & 5 < 6 [homes](/properties) <script>x</script>',
      opts,
    );
    const html = markdownToEmailHtml(nodes, 'https://havenhub.ng/');
    expect(html).toBe(
      // Tags are dropped; their inner text stays as (escaped) text.
      '<p>Hello &quot;friends&quot; &amp; 5 &lt; 6 <a href="https://havenhub.ng/properties">homes</a> x</p>',
    );
    expect(markdownToText(nodes)).toBe('Hello "friends" & 5 < 6 homes x');
  });

  it('estimates reading time', () => {
    expect(readingMinutes(parseMarkdown('word '.repeat(1000), opts))).toBe(5);
    expect(readingMinutes([])).toBe(1);
  });
});

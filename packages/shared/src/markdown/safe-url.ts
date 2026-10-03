/**
 * URL rules shared by CMS links, buttons and Markdown. Only these forms are
 * ever rendered as a link:
 *   https://…  http://…        absolute web URLs
 *   mailto:…  tel:…            contact links
 *   /path  /path?x#y           same-site paths (never "//host" or "/\host")
 *   #anchor                    in-page anchors
 * Everything else — javascript:, data:, vbscript:, file:, protocol-relative
 * URLs, URLs hiding a scheme behind whitespace or control characters — is
 * rejected.
 */

const HIDDEN =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0020\u007F-\u00A0\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF]/;

export function isSafeHref(raw: string): boolean {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2000) return false;
  if (HIDDEN.test(raw)) return false;
  if (raw.startsWith('#')) return /^#[A-Za-z0-9_-]{0,100}$/.test(raw);
  if (raw.startsWith('/')) return !raw.startsWith('//') && !raw.includes('\\');
  const lower = raw.toLowerCase();
  if (lower.startsWith('mailto:')) return /^mailto:[^\s@<>()]+@[^\s@<>()]+$/i.test(raw);
  if (lower.startsWith('tel:')) return /^tel:\+?[0-9()-]{3,30}$/.test(raw);
  if (!lower.startsWith('https://') && !lower.startsWith('http://')) return false;
  try {
    const url = new URL(raw);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

export const isExternalHref = (href: string) => /^https?:\/\//i.test(href);

/** CMS images live under `<media base>/cms/` with server-generated keys. */
const CMS_IMAGE_PATH = /^cms\/[a-z0-9][a-z0-9/_-]*\.webp$/;

/**
 * True when `src` is a HavenHub CMS image served from `mediaBase` (e.g.
 * "/api/media" or "https://cdn.example.com"). Anything else is not rendered.
 */
export function isCmsImageSrc(src: string, mediaBase: string): boolean {
  if (typeof src !== 'string' || HIDDEN.test(src) || src.includes('..')) return false;
  const base = mediaBase.replace(/\/+$/, '');
  if (!base || !src.startsWith(`${base}/`)) return false;
  return CMS_IMAGE_PATH.test(src.slice(base.length + 1));
}

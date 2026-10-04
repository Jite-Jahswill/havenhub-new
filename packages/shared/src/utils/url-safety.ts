/**
 * Production URL checks shared by the API and web configuration: public URLs
 * must be HTTPS and must not point at this machine. Returns why a URL is
 * unsafe, or null when it is fine.
 */
export function unsafeProductionUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'is not a valid URL';
  }
  if (url.protocol !== 'https:') return 'must use https in production';
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '::' ||
    host === '::1' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  ) {
    return 'must not point at localhost in production';
  }
  return null;
}

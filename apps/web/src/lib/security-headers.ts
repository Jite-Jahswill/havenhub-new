/**
 * Response headers for every page (wired in next.config.ts).
 *
 * The Content-Security-Policy is deliberately conservative: it restricts
 * framing, plugins, <base> and form targets, and leaves script/style/img/
 * connect sources open (no nonce-based script policy yet), so Next.js
 * scripts, fonts, map tiles, CMS images, Socket.IO and video embeds keep
 * working unchanged.
 *  - frame-ancestors 'none'   nobody may frame HavenHub (clickjacking)
 *  - object-src 'none'        no plugins
 *  - base-uri 'self'          an injected <base> cannot redirect relative URLs
 *  - form-action              forms post only to this site — plus Paystack's
 *                             checkout, kept as a safeguard for the payment
 *                             redirect (today it is a navigation, not a form)
 *
 * HSTS is sent only for a production build served over https, so local http
 * development and `next start` on localhost are never pinned to https.
 */
export const PAYSTACK_CHECKOUT_ORIGIN = 'https://checkout.paystack.com';
export const HSTS_VALUE = 'max-age=31536000';

export const CONTENT_SECURITY_POLICY = [
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  `form-action 'self' ${PAYSTACK_CHECKOUT_ORIGIN}`,
].join('; ');

export function securityHeaders(options: {
  production: boolean;
  siteUrl: string;
}): { key: string; value: string }[] {
  const headers = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
    { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
  ];
  if (options.production && options.siteUrl.startsWith('https://')) {
    headers.push({ key: 'Strict-Transport-Security', value: HSTS_VALUE });
  }
  return headers;
}

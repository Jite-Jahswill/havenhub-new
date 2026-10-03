import type { PlatformStatusView } from '@havenhub/shared';

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Only same-site paths or https URLs are used as the logo source. */
const safeSrc = (url: string) => (/^\/(?!\/)/.test(url) || /^https:\/\//i.test(url) ? url : null);

/**
 * The maintenance page, rendered by the proxy as a self-contained document so
 * it can be served with HTTP 503 + Retry-After. Every dynamic value is escaped;
 * branding and contact details come from the CMS site settings.
 */
export function maintenancePage(status: PlatformStatusView): string {
  const { maintenance: m, site } = status;
  const name = escape(site.name);
  const logo = site.logo && safeSrc(site.logo.url);
  const contact = [
    site.contactEmail &&
      `<a href="mailto:${escape(site.contactEmail)}">${escape(site.contactEmail)}</a>`,
    site.contactPhone &&
      `<a href="tel:${escape(site.contactPhone.replace(/[^\d+]/g, ''))}">${escape(site.contactPhone)}</a>`,
    site.contactAddress && `<span>${escape(site.contactAddress)}</span>`,
  ].filter(Boolean);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${name} is under maintenance</title>
<style>
  :root { color-scheme: light dark; --bg:#F5F5F5; --card:#FFFFFF; --text:#222222; --muted:#5C5C5C; --line:#E5E5E5; --brand:#D82227; }
  @media (prefers-color-scheme: dark) { :root { --bg:#121212; --card:#1E1E1E; --text:#F2F2F2; --muted:#B3B3B3; --line:#333333; --brand:#F0444A; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px 16px; background:var(--bg); color:var(--text); font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  main { width:100%; max-width:520px; background:var(--card); border:1px solid var(--line); border-radius:20px; padding:40px 28px; text-align:center; }
  .brand { display:flex; align-items:center; justify-content:center; gap:8px; font-weight:700; font-size:20px; margin-bottom:28px; }
  .brand img { max-height:40px; width:auto; }
  .mark { width:12px; height:12px; background:var(--brand); border-radius:3px; display:inline-block; }
  h1 { font-size:24px; line-height:1.3; margin:0 0 12px; }
  p { color:var(--muted); line-height:1.6; margin:0 0 12px; overflow-wrap:anywhere; }
  .return { color:var(--text); font-weight:600; }
  .contact { margin-top:24px; padding-top:20px; border-top:1px solid var(--line); display:flex; flex-direction:column; gap:6px; font-size:14px; color:var(--muted); overflow-wrap:anywhere; }
  a { color:var(--brand); }
</style>
</head>
<body>
<main>
  <div class="brand">${logo ? `<img src="${escape(logo)}" alt="${name}">` : `<span class="mark" aria-hidden="true"></span><span>${name}</span>`}</div>
  <h1>We’ll be back soon</h1>
  <p>${escape(m.message ?? `${site.name} is down for scheduled maintenance.`)}</p>
  ${m.returnText ? `<p class="return">${escape(m.returnText)}</p>` : ''}
  ${contact.length ? `<div class="contact"><span>Need help?</span>${contact.join('')}</div>` : ''}
</main>
</body>
</html>`;
}

import type { MailMessage } from './mail.types';

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

interface LayoutInput {
  to: string;
  subject: string;
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footnote?: string;
}

/** Minimal, client-safe HTML layout with a plain-text alternative. */
function render(input: LayoutInput): MailMessage {
  const textParts = [
    input.heading,
    '',
    ...input.paragraphs,
    ...(input.action ? ['', `${input.action.label}: ${input.action.url}`] : []),
    ...(input.footnote ? ['', input.footnote] : []),
    '',
    '— HavenHub',
  ];

  const button = input.action
    ? `<p style="margin:32px 0"><a href="${escapeHtml(input.action.url)}" style="background:#D82227;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:12px;font-weight:600;display:inline-block">${escapeHtml(input.action.label)}</a></p>
       <p style="color:#5c5c5c;font-size:13px">Or paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(input.action.url)}</span></p>`
    : '';

  const html = `<!doctype html><html><body style="margin:0;background:#F5F5F5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#222222">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:40px">
      <tr><td>
        <p style="margin:0 0 32px;font-weight:700;font-size:20px"><span style="color:#D82227">■</span> HavenHub</p>
        <h1 style="font-size:22px;margin:0 0 16px">${escapeHtml(input.heading)}</h1>
        ${input.paragraphs.map((p) => `<p style="line-height:1.6;margin:0 0 12px">${escapeHtml(p)}</p>`).join('')}
        ${button}
        ${input.footnote ? `<p style="color:#767676;font-size:13px;margin-top:32px">${escapeHtml(input.footnote)}</p>` : ''}
      </td></tr>
    </table>
  </td></tr></table></body></html>`;

  return { to: input.to, subject: input.subject, text: textParts.join('\n'), html };
}

export const MailTemplates = {
  // ── Subscriptions (Phase 4) ──
  subscriptionStarted: (
    to: string,
    name: string,
    planName: string,
    periodEnd: string,
    url: string,
    upgrade: boolean,
  ) =>
    render({
      to,
      subject: upgrade
        ? `You're now on HavenHub ${planName}`
        : `Your HavenHub ${planName} plan is active`,
      heading: `Welcome to ${planName}, ${name}`,
      paragraphs: [
        'Your payment was verified and your plan is active now.',
        `This term runs until ${periodEnd}. Your new limits apply immediately.`,
      ],
      action: { label: 'View your subscription', url },
    }),

  subscriptionScheduled: (
    to: string,
    name: string,
    planName: string,
    startsOn: string,
    url: string,
  ) =>
    render({
      to,
      subject: `Your HavenHub ${planName} plan is confirmed`,
      heading: `Payment received, ${name}`,
      paragraphs: [
        `Your ${planName} plan is paid for and starts on ${startsOn}, when your current term ends.`,
      ],
      action: { label: 'View your subscription', url },
    }),

  subscriptionPaymentFailed: (to: string, name: string, planName: string, url: string) =>
    render({
      to,
      subject: 'Your HavenHub subscription payment did not go through',
      heading: `Payment unsuccessful, ${name}`,
      paragraphs: [
        `We could not complete your payment for the ${planName} plan, and you have not been charged by HavenHub.`,
        'Your current plan is unchanged. You can try again at any time.',
      ],
      action: { label: 'Choose a plan', url },
    }),

  subscriptionExpiring: (to: string, name: string, planName: string, endsOn: string, url: string) =>
    render({
      to,
      subject: `Your HavenHub ${planName} plan ends on ${endsOn}`,
      heading: `Your plan ends soon, ${name}`,
      paragraphs: [
        `Your ${planName} term ends on ${endsOn}. Plans do not renew automatically.`,
        'Renew before then to keep your limits. Your listings and data are never deleted if a plan ends.',
      ],
      action: { label: 'Renew your plan', url },
    }),

  subscriptionEnded: (
    to: string,
    name: string,
    planName: string,
    reason: string,
    fallbackPlan: string,
    url: string,
  ) =>
    render({
      to,
      subject: `Your HavenHub ${planName} plan has ended`,
      heading: `Your ${planName} plan has ended, ${name}`,
      paragraphs: [
        reason,
        `You are now on the ${fallbackPlan} plan. Nothing has been deleted: listings above your new limits stay as they are, but you cannot add more until you are within your plan or upgrade.`,
      ],
      action: { label: 'See plans', url },
    }),

  planLimitReached: (
    to: string,
    name: string,
    planName: string,
    allowance: string,
    limit: number,
    url: string,
  ) =>
    render({
      to,
      subject: 'You have reached a limit on your HavenHub plan',
      heading: `You've reached a plan limit, ${name}`,
      paragraphs: [
        `Your ${planName} plan includes ${limit} for "${allowance}", and you have reached it.`,
        'Upgrade your plan to add more.',
      ],
      action: { label: 'View plans', url },
    }),

  verifyEmail: (to: string, name: string, url: string, hours: number) =>
    render({
      to,
      subject: 'Verify your HavenHub email address',
      heading: `Welcome to HavenHub, ${name}`,
      paragraphs: ['Please confirm your email address to activate your account.'],
      action: { label: 'Verify email address', url },
      footnote: `This link expires in ${hours} hours. If you did not create a HavenHub account, you can ignore this email.`,
    }),

  accountAlreadyExists: (to: string, loginUrl: string, resetUrl: string) =>
    render({
      to,
      subject: 'You already have a HavenHub account',
      heading: 'You already have an account',
      paragraphs: [
        'Someone (hopefully you) tried to create a HavenHub account with this email address, but an account already exists.',
        `You can sign in at ${loginUrl}, or reset your password if you have forgotten it.`,
      ],
      action: { label: 'Reset password', url: resetUrl },
      footnote: 'If this was not you, no action is needed — your account is unchanged.',
    }),

  passwordReset: (to: string, name: string, url: string, minutes: number) =>
    render({
      to,
      subject: 'Reset your HavenHub password',
      heading: `Reset your password, ${name}`,
      paragraphs: ['We received a request to reset the password for your HavenHub account.'],
      action: { label: 'Choose a new password', url },
      footnote: `This link expires in ${minutes} minutes and can be used once. If you did not request a reset, you can ignore this email.`,
    }),

  passwordChanged: (to: string, name: string) =>
    render({
      to,
      subject: 'Your HavenHub password was changed',
      heading: `Your password was changed, ${name}`,
      paragraphs: [
        'The password for your HavenHub account was just changed and other devices were signed out.',
        'If you did not make this change, reset your password immediately and contact support.',
      ],
    }),
};

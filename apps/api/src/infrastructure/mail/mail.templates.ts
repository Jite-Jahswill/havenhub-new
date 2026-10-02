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

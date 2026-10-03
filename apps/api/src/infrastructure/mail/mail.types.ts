export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers (e.g. List-Unsubscribe on campaign email). */
  headers?: Record<string, string>;
}

/**
 * Delivery mechanism for outgoing email. SMTP today; an API-based provider
 * (Postmark, SES, Resend…) can be added by implementing this interface.
 */
export interface MailTransport {
  readonly name: string;
  send(message: MailMessage): Promise<void>;
}

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

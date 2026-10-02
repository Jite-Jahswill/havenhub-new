import nodemailer, { type Transporter } from 'nodemailer';

import type { Env } from '../../../config/env';
import type { MailMessage, MailTransport } from '../mail.types';

export class SmtpMailTransport implements MailTransport {
  readonly name = 'smtp';
  private readonly transporter: Transporter;

  constructor(private readonly env: Env) {
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ?? 587,
      secure: env.SMTP_SECURE ?? env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.env.MAIL_FROM, ...message });
  }
}

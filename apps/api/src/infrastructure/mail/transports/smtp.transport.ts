import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';

import type { MailMessage, MailTransport } from '../mail.types';

export interface SmtpConnectionOptions {
  /** Host name or (for database settings) the already-checked IP address. */
  host: string;
  /** TLS server name to verify when `host` is an IP address. */
  servername?: string;
  port: number;
  /** Implicit TLS. */
  secure: boolean;
  /** Refuse to continue unless STARTTLS succeeds. */
  requireTLS: boolean;
  auth?: { user: string; pass: string };
}

export type SmtpSender = string | { name: string; address: string };

export interface SmtpConnection {
  sendMail(mail: MailMessage & { from: SmtpSender }): Promise<unknown>;
  close(): void;
}

/** Opens nodemailer SMTP connections (a seam that tests replace). */
@Injectable()
export class SmtpConnector {
  connect(options: SmtpConnectionOptions): SmtpConnection {
    const transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      requireTLS: options.requireTLS,
      auth: options.auth,
      tls: options.servername ? { servername: options.servername } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
    return {
      sendMail: (mail) => transporter.sendMail(mail),
      close: () => transporter.close(),
    };
  }
}

/** SMTP using a fixed connection (the environment-variable fallback). */
export class SmtpMailTransport implements MailTransport {
  readonly name = 'smtp';

  constructor(
    private readonly connection: SmtpConnection,
    private readonly from: SmtpSender,
  ) {}

  async send(message: MailMessage): Promise<void> {
    await this.connection.sendMail({ from: this.from, ...message });
  }
}

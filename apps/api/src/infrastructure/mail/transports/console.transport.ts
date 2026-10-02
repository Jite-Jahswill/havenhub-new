import { Logger } from '@nestjs/common';

import type { MailMessage, MailTransport } from '../mail.types';

/**
 * Development fallback when SMTP is not configured: prints the email
 * (including verification links) to the API log. Never used in production —
 * env validation requires SMTP there.
 */
export class ConsoleMailTransport implements MailTransport {
  readonly name = 'console';
  private readonly logger = new Logger('Mail');

  send(message: MailMessage): Promise<void> {
    this.logger.log(`\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n`);
    return Promise.resolve();
  }
}

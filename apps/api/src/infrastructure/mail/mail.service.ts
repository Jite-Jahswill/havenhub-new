import { Inject, Injectable, Logger } from '@nestjs/common';

import { MAIL_TRANSPORT, type MailMessage, type MailTransport } from './mail.types';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(@Inject(MAIL_TRANSPORT) private readonly transport: MailTransport) {}

  /**
   * Sends an email without failing the calling request: account flows must
   * not reveal delivery problems (or account existence) to the client.
   * Failures are logged for operators. A queue with retries replaces this
   * in a later phase.
   */
  async send(message: MailMessage): Promise<void> {
    try {
      await this.transport.send(message);
    } catch (error) {
      this.logger.error(
        `Failed to send "${message.subject}" via ${this.transport.name}: ${(error as Error).message}`,
      );
    }
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';

import { describeError } from '../../common/logging/describe-error';
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
      // No recipient, subject or server reply (it can quote addresses).
      this.logger.error('Email could not be sent', {
        event: 'mail.send_failed',
        transport: this.transport.name,
        ...describeError(error),
      });
    }
  }
}

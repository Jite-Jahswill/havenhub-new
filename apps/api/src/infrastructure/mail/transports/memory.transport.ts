import type { MailMessage, MailTransport } from '../mail.types';

/** Captures messages in memory. Used by automated tests. */
export class MemoryMailTransport implements MailTransport {
  readonly name = 'memory';
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  lastTo(email: string): MailMessage | undefined {
    return this.sent.filter((m) => m.to === email).at(-1);
  }

  clear(): void {
    this.sent.length = 0;
  }
}

import { Global, Module } from '@nestjs/common';

import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { MailService } from './mail.service';
import { MAIL_TRANSPORT, type MailTransport } from './mail.types';
import { ConsoleMailTransport } from './transports/console.transport';
import { MemoryMailTransport } from './transports/memory.transport';
import { SmtpMailTransport } from './transports/smtp.transport';

@Global()
@Module({
  providers: [
    {
      provide: MAIL_TRANSPORT,
      inject: [ENV],
      useFactory: (env: Env): MailTransport => {
        if (env.SMTP_HOST) return new SmtpMailTransport(env);
        if (env.NODE_ENV === 'test') return new MemoryMailTransport();
        return new ConsoleMailTransport();
      },
    },
    MailService,
  ],
  exports: [MailService, MAIL_TRANSPORT],
})
export class MailModule {}

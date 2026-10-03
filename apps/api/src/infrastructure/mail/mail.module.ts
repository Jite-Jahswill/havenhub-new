import { Global, Inject, Module, type OnApplicationBootstrap } from '@nestjs/common';

import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import {
  MailTransportResolver,
  ResolvingMailTransport,
  SMTP_DNS_RESOLVER,
} from './mail-transport.resolver';
import { MailService } from './mail.service';
import { MAIL_TRANSPORT, type MailTransport } from './mail.types';
import { systemResolver } from './smtp-destination';
import { ConsoleMailTransport } from './transports/console.transport';
import { MemoryMailTransport } from './transports/memory.transport';
import { SmtpConnector } from './transports/smtp.transport';

@Global()
@Module({
  providers: [
    SmtpConnector,
    { provide: SMTP_DNS_RESOLVER, useValue: systemResolver },
    MailTransportResolver,
    {
      provide: MAIL_TRANSPORT,
      inject: [ENV, MailTransportResolver],
      useFactory: (env: Env, resolver: MailTransportResolver): MailTransport => {
        // Automated tests capture email in memory unless SMTP is explicitly configured.
        if (env.NODE_ENV === 'test' && !env.SMTP_HOST) return new MemoryMailTransport();
        return new ResolvingMailTransport(
          resolver,
          env.NODE_ENV === 'production' ? null : new ConsoleMailTransport(),
        );
      },
    },
    MailService,
  ],
  exports: [MailService, MAIL_TRANSPORT, MailTransportResolver, SMTP_DNS_RESOLVER],
})
export class MailModule implements OnApplicationBootstrap {
  constructor(
    private readonly resolver: MailTransportResolver,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Production must be able to deliver verification email: SMTP has to come
   * from the admin settings or the SMTP_* variables. Checked at startup.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (this.env.NODE_ENV !== 'production') return;
    const { source } = await this.resolver.resolve();
    if (source === 'NONE') {
      throw new Error(
        'SMTP is not configured: set SMTP_HOST (and related variables) or configure SMTP in the admin settings.',
      );
    }
  }
}

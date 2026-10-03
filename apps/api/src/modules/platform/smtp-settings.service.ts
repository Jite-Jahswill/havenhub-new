import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type SmtpSettingsView,
  type SmtpTestResult,
  type updateSmtpSettingsSchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { AppException, Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { SmtpSettings } from '../../generated/prisma/client';
import {
  MailTransportResolver,
  SMTP_DNS_RESOLVER,
  SmtpSendError,
} from '../../infrastructure/mail/mail-transport.resolver';
import { MailTemplates } from '../../infrastructure/mail/mail.templates';
import {
  resolvePublicAddress,
  SmtpDestinationError,
  type Resolver,
} from '../../infrastructure/mail/smtp-destination';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';

type Input = z.output<typeof updateSmtpSettingsSchema>;

/**
 * Admin-managed SMTP. The password is write-only: it is encrypted on the
 * way in and never leaves the API again — not in responses, audit entries,
 * logs or error messages. All delivery goes through MailTransportResolver.
 */
@Injectable()
export class SmtpSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly resolver: MailTransportResolver,
    @Inject(ENV) private readonly env: Env,
    @Inject(SMTP_DNS_RESOLVER) private readonly dns: Resolver,
  ) {}

  async view(): Promise<SmtpSettingsView> {
    const row = await this.prisma.smtpSettings.findUnique({
      where: { id: 1 },
      include: { updatedBy: { select: { id: true, fullName: true } } },
    });
    const environment = this.env.SMTP_HOST ? { host: this.env.SMTP_HOST } : null;
    return {
      source: row ? 'DATABASE' : environment ? 'ENVIRONMENT' : 'NONE',
      database: row
        ? {
            host: row.host,
            port: row.port,
            security: row.security,
            username: row.username,
            passwordSet: Boolean(row.passwordCiphertext),
            fromEmail: row.fromEmail,
            fromName: row.fromName,
            updatedAt: row.updatedAt.toISOString(),
            updatedBy: row.updatedBy,
          }
        : null,
      environment,
    };
  }

  async update(actor: AuthContext, input: Input, meta: RequestMeta): Promise<SmtpSettingsView> {
    // Refuse internal destinations before anything is stored.
    try {
      await resolvePublicAddress(input.host, this.dns);
    } catch (error) {
      throw fieldError(
        'host',
        error instanceof SmtpDestinationError
          ? 'This server address is not allowed (private, local and reserved addresses are blocked).'
          : 'This server name could not be found.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // The row may not exist yet, so serialise on an advisory lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('settings:smtp'))`;
      const current = await tx.smtpSettings.findUnique({ where: { id: 1 } });

      let passwordCiphertext: string | null;
      if (!input.username) passwordCiphertext = null;
      else if (input.password === undefined)
        passwordCiphertext = current?.passwordCiphertext ?? null;
      else if (input.password === null) passwordCiphertext = null;
      else passwordCiphertext = this.resolver.passwordCipher.encrypt(input.password);
      if (input.username && !passwordCiphertext) {
        throw fieldError('password', 'Enter the password for this username');
      }

      const data = {
        host: input.host,
        port: input.port,
        security: input.security,
        username: input.username,
        passwordCiphertext,
        fromEmail: input.fromEmail,
        fromName: input.fromName,
        updatedById: actor.user.id,
      };
      const saved = current
        ? await tx.smtpSettings.update({
            where: { id: 1 },
            data: { ...data, version: { increment: 1 } },
          })
        : await tx.smtpSettings.create({ data: { id: 1, ...data } });

      await this.audit.record(
        {
          actorId: actor.user.id,
          action: current ? 'settings.smtp.updated' : 'settings.smtp.configured',
          resourceType: 'smtp_settings',
          resourceId: '1',
          before: current ? redacted(current) : undefined,
          after: {
            ...redacted(saved),
            passwordChanged: current?.passwordCiphertext !== saved.passwordCiphertext,
          },
          meta,
        },
        tx,
      );
    });
    await this.resolver.publish();
    return this.view();
  }

  /** Removes the database settings: email falls back to the SMTP_* variables (if set). */
  async remove(actor: AuthContext, meta: RequestMeta): Promise<SmtpSettingsView> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('settings:smtp'))`;
      const current = await tx.smtpSettings.findUnique({ where: { id: 1 } });
      if (!current) throw Errors.notFound('SMTP settings');
      await tx.smtpSettings.delete({ where: { id: 1 } });
      await this.audit.record(
        {
          actorId: actor.user.id,
          action: 'settings.smtp.removed',
          resourceType: 'smtp_settings',
          resourceId: '1',
          before: redacted(current),
          meta,
        },
        tx,
      );
    });
    await this.resolver.publish();
    return this.view();
  }

  /**
   * Sends a test email through the active settings — only ever to the
   * signed-in administrator's own (verified) address, so it cannot be used
   * to send mail to anyone else.
   */
  async test(actor: AuthContext, meta: RequestMeta): Promise<SmtpTestResult> {
    const resolved = await this.resolver.resolve();
    if (!resolved.transport) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        'No SMTP server is configured yet.',
      );
    }
    const to = actor.user.email;
    let error: SmtpSendError | null = null;
    try {
      await resolved.transport.send(
        MailTemplates.smtpTest(to, resolved.source === 'DATABASE' ? 'admin-managed' : 'server'),
      );
    } catch (caught) {
      error =
        caught instanceof SmtpSendError
          ? caught
          : new SmtpSendError('The email could not be sent.', 'EUNKNOWN');
    }
    await this.audit.record({
      actorId: actor.user.id,
      action: 'settings.smtp.test_sent',
      resourceType: 'smtp_settings',
      resourceId: '1',
      after: { source: resolved.source, delivered: !error, errorCode: error?.code ?? null },
      meta,
    });
    return { delivered: !error, to, error: error?.message ?? null };
  }
}

/** Audit-safe snapshot: never the password or its ciphertext. */
const redacted = (row: SmtpSettings) => ({
  host: row.host,
  port: row.port,
  security: row.security,
  username: row.username,
  passwordSet: Boolean(row.passwordCiphertext),
  fromEmail: row.fromEmail,
  fromName: row.fromName,
});

const fieldError = (path: string, message: string) =>
  new AppException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    ErrorCode.VALIDATION_ERROR,
    'Please check the highlighted fields.',
    { issues: [{ path, message }] },
  );

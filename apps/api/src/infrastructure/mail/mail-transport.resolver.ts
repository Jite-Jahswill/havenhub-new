import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SmtpSource } from '@havenhub/shared';

import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { SmtpSettings } from '../../generated/prisma/client';
import { FieldEncryptionService, type SecretCipher } from '../crypto/field-encryption.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import type { MailMessage, MailTransport } from './mail.types';
import { resolvePublicAddress, SmtpDestinationError, type Resolver } from './smtp-destination';
import { SmtpConnector, SmtpMailTransport } from './transports/smtp.transport';

/** Redis key holding a token for the current SMTP settings (shared by all API instances). */
export const SMTP_TOKEN_KEY = 'mail:smtp:token';
/** Bounded staleness if a Redis write is lost: the token is re-read from the database. */
const TOKEN_TTL_SECONDS = 60;
/** The encryption purpose (HKDF label and GCM associated data) of the stored password. */
export const SMTP_PASSWORD_PURPOSE = 'smtp-password';
/** Optional DNS resolver override (tests). */
export const SMTP_DNS_RESOLVER = Symbol('SMTP_DNS_RESOLVER');

export type ResolvedMail =
  | { source: Exclude<SmtpSource, 'NONE'>; transport: MailTransport }
  | { source: 'NONE'; transport: null };

/** Delivery failure with a generic, safe message (server replies are never echoed). */
export class SmtpSendError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'SmtpSendError';
  }
}

/**
 * The single place that decides how email leaves the API:
 *
 *   database settings (admin-managed) → SMTP_* environment variables → none
 *
 * Settings changes propagate through a token in Redis: every send compares
 * it with the token this instance built its transport from and rebuilds on
 * a change. Database transports open a fresh connection per message to an
 * address checked at that moment, so an in-flight email is never affected
 * by a settings change and DNS cannot be rebound to an internal address.
 */
@Injectable()
export class MailTransportResolver {
  private readonly logger = new Logger(MailTransportResolver.name);
  private readonly cipher: SecretCipher;
  private cached: { token: string; resolved: ResolvedMail } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly connector: SmtpConnector,
    encryption: FieldEncryptionService,
    @Inject(ENV) private readonly env: Env,
    @Inject(SMTP_DNS_RESOLVER) private readonly dns: Resolver,
  ) {
    this.cipher = encryption.forPurpose(SMTP_PASSWORD_PURPOSE);
  }

  /** The cipher for the stored SMTP password (used only by the settings service). */
  get passwordCipher(): SecretCipher {
    return this.cipher;
  }

  async resolve(): Promise<ResolvedMail> {
    const token = await this.currentToken();
    if (this.cached?.token === token) return this.cached.resolved;
    const row = await this.prisma.smtpSettings.findUnique({ where: { id: 1 } });
    // The row may have changed between reading the token and the row: build
    // from the row and remember the row's own token.
    const resolved = this.build(row);
    this.cached = { token: tokenOf(row), resolved };
    return resolved;
  }

  /** Call after a committed settings change, so every instance rebuilds. */
  async publish(): Promise<void> {
    const row = await this.prisma.smtpSettings.findUnique({
      where: { id: 1 },
      select: { id: true, version: true, updatedAt: true },
    });
    this.cached = null;
    try {
      await this.redis.client.set(SMTP_TOKEN_KEY, tokenOf(row), 'EX', TOKEN_TTL_SECONDS);
    } catch (error) {
      // Other instances pick the change up when the token expires.
      this.logger.warn(`SMTP settings token not published: ${(error as Error).message}`);
    }
  }

  private async currentToken(): Promise<string> {
    try {
      const token = await this.redis.client.get(SMTP_TOKEN_KEY);
      if (token) return token;
    } catch {
      // Redis unavailable: fall through to the database.
    }
    const row = await this.prisma.smtpSettings.findUnique({
      where: { id: 1 },
      select: { id: true, version: true, updatedAt: true },
    });
    const token = tokenOf(row);
    // NX: never overwrite a newer token published meanwhile.
    this.redis.client
      .set(SMTP_TOKEN_KEY, token, 'EX', TOKEN_TTL_SECONDS, 'NX')
      .catch(() => undefined);
    return token;
  }

  private build(row: SmtpSettings | null): ResolvedMail {
    if (row) {
      let password: string | null = null;
      if (row.passwordCiphertext) {
        try {
          password = this.cipher.decrypt(row.passwordCiphertext);
        } catch {
          // Never fall back to other settings silently: database settings win.
          this.logger.error(
            'The stored SMTP password cannot be decrypted (was FIELD_ENCRYPTION_KEY changed?). Re-enter it in the admin settings.',
          );
          return { source: 'DATABASE', transport: new UnusableTransport() };
        }
      }
      return {
        source: 'DATABASE',
        transport: new DatabaseSmtpTransport(row, password, this.connector, this.dns),
      };
    }
    if (this.env.SMTP_HOST) {
      const env = this.env;
      const connection = this.connector.connect({
        host: env.SMTP_HOST!,
        port: env.SMTP_PORT ?? 587,
        secure: env.SMTP_SECURE ?? env.SMTP_PORT === 465,
        requireTLS: false,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } : undefined,
      });
      return { source: 'ENVIRONMENT', transport: new SmtpMailTransport(connection, env.MAIL_FROM) };
    }
    return { source: 'NONE', transport: null };
  }
}

const tokenOf = (row: Pick<SmtpSettings, 'id' | 'version' | 'updatedAt'> | null) =>
  row ? `db:${row.version}:${row.updatedAt.getTime()}` : 'none';

/** Admin-managed SMTP: a checked public address and a new connection for every message. */
class DatabaseSmtpTransport implements MailTransport {
  readonly name = 'smtp-database';

  constructor(
    private readonly settings: SmtpSettings,
    private readonly password: string | null,
    private readonly connector: SmtpConnector,
    private readonly dns?: Resolver,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const { host, port, security, username, fromEmail, fromName } = this.settings;
    let address: string;
    try {
      address = await resolvePublicAddress(host, this.dns);
    } catch (error) {
      if (error instanceof SmtpDestinationError) throw new SmtpSendError(error.message, 'EBLOCKED');
      throw new SmtpSendError('The SMTP server name could not be resolved.', 'EDNS');
    }
    const connection = this.connector.connect({
      host: address,
      servername: host,
      port,
      secure: security === 'TLS',
      requireTLS: security === 'STARTTLS',
      auth: username ? { user: username, pass: this.password ?? '' } : undefined,
    });
    try {
      await connection.sendMail({ from: { name: fromName, address: fromEmail }, ...message });
    } catch (error) {
      throw safeError(error);
    } finally {
      connection.close();
    }
  }
}

class UnusableTransport implements MailTransport {
  readonly name = 'smtp-database';
  send(): Promise<void> {
    return Promise.reject(
      new SmtpSendError('The stored SMTP password could not be read. Enter it again.', 'EKEY'),
    );
  }
}

function safeError(error: unknown): SmtpSendError {
  const code = (error as { code?: string }).code ?? 'EUNKNOWN';
  switch (code) {
    case 'EAUTH':
      return new SmtpSendError('The server rejected the username or password.', code);
    case 'ETLS':
      return new SmtpSendError('A secure connection could not be established.', code);
    case 'EENVELOPE':
    case 'EMESSAGE':
      return new SmtpSendError('The server refused the message.', code);
    case 'ECONNECTION':
    case 'ETIMEDOUT':
    case 'ESOCKET':
    case 'EDNS':
    case 'ECONNREFUSED':
      return new SmtpSendError('Could not connect to the SMTP server.', code);
    default:
      return new SmtpSendError('The email could not be sent.', code);
  }
}

/**
 * MAIL_TRANSPORT outside tests: always asks the resolver. In development a
 * console fallback prints emails when no SMTP is configured; in production
 * there is no fallback (startup refuses to run without SMTP).
 */
export class ResolvingMailTransport implements MailTransport {
  readonly name = 'smtp-resolver';

  constructor(
    private readonly resolver: MailTransportResolver,
    private readonly fallback: MailTransport | null,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const { transport } = await this.resolver.resolve();
    if (transport) return transport.send(message);
    if (this.fallback) return this.fallback.send(message);
    throw new SmtpSendError('No SMTP server is configured.', 'ENOSMTP');
  }
}

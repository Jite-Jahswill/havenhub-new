import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  AccountType,
  ErrorCode,
  UserStatus,
  type AuthUser,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterAgentInput,
  type RegisterCustomerInput,
  type ResetPasswordInput,
} from '@havenhub/shared';

import { AppException } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { ClientType, Prisma, VerificationTokenType } from '../../generated/prisma/client';
import { MailService } from '../../infrastructure/mail/mail.service';
import { MailTemplates } from '../../infrastructure/mail/mail.templates';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import { toAuthUser } from '../users/user.mapper';
import { accountStatusError } from './guards/authentication.guard';
import { PasswordService } from './password.service';
import { SessionService, type IssuedSession } from './session.service';
import { TOKEN_TTL_MINUTES, VerificationTokenService } from './verification-token.service';

type RegisterCustomer = Omit<RegisterCustomerInput, 'phone'> & { phone?: string };
type RegisterAgent = Omit<RegisterAgentInput, 'sex' | 'serviceTypes'> & {
  sex: NonNullable<RegisterAgentInput['sex']>;
  serviceTypes: NonNullable<RegisterAgentInput['serviceTypes']>;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly tokens: VerificationTokenService,
    private readonly mail: MailService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ── Registration ──────────────────────────────────────────────────────────
  //
  // Public registration can only ever create CUSTOMER or AGENT accounts: the
  // account type is fixed by the endpoint, never read from the request body.
  // The response is identical whether or not the email is already registered,
  // so registration cannot be used to discover accounts.

  async registerCustomer(input: RegisterCustomer): Promise<void> {
    await this.register(input.email, input.password, (passwordHash) =>
      this.prisma.user.create({
        data: {
          email: input.email,
          passwordHash,
          fullName: input.fullName,
          phone: input.phone ?? null,
          accountType: AccountType.CUSTOMER,
        },
      }),
    );
  }

  async registerAgent(input: RegisterAgent): Promise<void> {
    await this.register(input.email, input.password, (passwordHash) =>
      this.prisma.user.create({
        data: {
          email: input.email,
          passwordHash,
          fullName: input.fullName,
          phone: input.phone,
          accountType: AccountType.AGENT,
          agentProfile: {
            create: {
              sex: input.sex,
              serviceTypes: input.serviceTypes,
              businessName: input.businessName || null,
            },
          },
        },
      }),
    );
  }

  private async register(
    email: string,
    password: string,
    create: (passwordHash: string) => Promise<{ id: string; email: string; fullName: string }>,
  ): Promise<void> {
    const passwordHash = await this.passwords.hash(password);
    try {
      const user = await create(passwordHash);
      await this.sendVerificationEmail(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        await this.mail.send(
          MailTemplates.accountAlreadyExists(
            email,
            `${this.env.WEB_APP_URL}/login`,
            `${this.env.WEB_APP_URL}/forgot-password`,
          ),
        );
        return;
      }
      throw error;
    }
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  async login(input: LoginInput, clientType: ClientType, meta: RequestMeta) {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const valid = user
      ? await this.passwords.verify(user.passwordHash, input.password)
      : await this.passwords.verifyDummy(input.password);

    if (!user || !valid) {
      // Neither the email nor the password is logged; the request id and
      // canonical IP (rate limiting) identify the attempt.
      this.logger.warn('Sign-in failed', {
        event: 'auth.login_failed',
        reason: 'invalid_credentials',
        clientType,
      });
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.INVALID_CREDENTIALS,
        'Incorrect email or password.',
      );
    }
    // Status and verification are only revealed after a correct password.
    if (user.status !== UserStatus.ACTIVE) {
      this.logger.warn('Sign-in refused', {
        event: 'auth.login_failed',
        reason: `account_${user.status.toLowerCase()}`,
        userId: user.id,
        clientType,
      });
      throw accountStatusError(user.status);
    }
    if (this.env.REQUIRE_EMAIL_VERIFICATION && !user.emailVerifiedAt) {
      this.logger.warn('Sign-in refused', {
        event: 'auth.login_failed',
        reason: 'email_not_verified',
        userId: user.id,
        clientType,
      });
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.EMAIL_NOT_VERIFIED,
        'Please verify your email address. We can send you a new link.',
      );
    }

    const issued = await this.sessions.create(user.id, clientType, meta);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    if (user.accountType === AccountType.ADMIN) {
      await this.audit.record({
        actorId: user.id,
        action: 'auth.admin_login',
        resourceType: 'session',
        resourceId: issued.session.id,
        meta,
      });
    }
    return { issued, user: await this.authUser(user.id) };
  }

  async refresh(refreshToken: string, clientType: ClientType, meta: RequestMeta) {
    const rotated = await this.sessions.rotate(refreshToken, clientType, meta);
    if (rotated.user.status !== UserStatus.ACTIVE) {
      await this.sessions.revoke(rotated.session.id, 'account_status_changed');
      throw accountStatusError(rotated.user.status);
    }
    const issued: IssuedSession = { session: rotated.session, tokens: rotated.tokens };
    return { issued, user: await this.authUser(rotated.user.id) };
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    const session = await this.sessions.findByAnyToken(token);
    if (session) await this.sessions.revoke(session.id, 'logout');
  }

  async authUser(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return toAuthUser(user, await this.rbac.getAccess(user.id, user.accountType), (key) =>
      this.storage.url(key),
    );
  }

  // ── Email verification ────────────────────────────────────────────────────

  async verifyEmail(token: string): Promise<void> {
    const verified = await this.prisma.$transaction(async (tx) => {
      const userId = await this.tokens.consume(token, VerificationTokenType.EMAIL_VERIFICATION, tx);
      if (!userId) return false;
      await tx.user.updateMany({
        where: { id: userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date() },
      });
      return true;
    });
    if (!verified) throw invalidLink();
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerifiedAt && user.status === UserStatus.ACTIVE) {
      await this.sendVerificationEmail(user);
    }
  }

  private async sendVerificationEmail(user: { id: string; email: string; fullName: string }) {
    const token = await this.tokens.issue(user.id, VerificationTokenType.EMAIL_VERIFICATION);
    const url = `${this.env.WEB_APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
    await this.mail.send(
      MailTemplates.verifyEmail(
        user.email,
        firstName(user.fullName),
        url,
        TOKEN_TTL_MINUTES.EMAIL_VERIFICATION / 60,
      ),
    );
  }

  // ── Passwords ─────────────────────────────────────────────────────────────

  /** Always succeeds from the caller's point of view (no account enumeration). */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== UserStatus.ACTIVE) return;
    const token = await this.tokens.issue(user.id, VerificationTokenType.PASSWORD_RESET);
    const url = `${this.env.WEB_APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
    await this.mail.send(
      MailTemplates.passwordReset(
        user.email,
        firstName(user.fullName),
        url,
        TOKEN_TTL_MINUTES.PASSWORD_RESET,
      ),
    );
  }

  /**
   * Sets a new password from an emailed token. Signs out every device and,
   * because the user proved control of the inbox, marks the email verified.
   */
  async resetPassword(input: ResetPasswordInput, meta: RequestMeta): Promise<void> {
    const passwordHash = await this.passwords.hash(input.password);
    const user = await this.prisma.$transaction(async (tx) => {
      const userId = await this.tokens.consume(
        input.token,
        VerificationTokenType.PASSWORD_RESET,
        tx,
      );
      if (!userId) return null;
      const { emailVerifiedAt } = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { emailVerifiedAt: true },
      });
      const updated = await tx.user.update({
        where: { id: userId },
        data: { passwordHash, emailVerifiedAt: emailVerifiedAt ?? new Date() },
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'password_reset' },
      });
      await this.audit.record(
        {
          actorId: userId,
          action: 'auth.password_reset',
          resourceType: 'user',
          resourceId: userId,
          meta,
        },
        tx,
      );
      return updated;
    });
    if (!user) throw invalidLink();
    await this.mail.send(MailTemplates.passwordChanged(user.email, firstName(user.fullName)));
  }

  /** Changes the password and signs out every other device. */
  async changePassword(
    userId: string,
    currentSessionId: string,
    input: ChangePasswordInput,
    meta: RequestMeta,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await this.passwords.verify(user.passwordHash, input.currentPassword))) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.VALIDATION_ERROR,
        'Your current password is incorrect.',
        { issues: [{ path: 'currentPassword', message: 'Incorrect password' }] },
      );
    }
    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await tx.session.updateMany({
        where: { userId, revokedAt: null, id: { not: currentSessionId } },
        data: { revokedAt: new Date(), revokedReason: 'password_changed' },
      });
      await this.audit.record(
        {
          actorId: userId,
          action: 'auth.password_changed',
          resourceType: 'user',
          resourceId: userId,
          meta,
        },
        tx,
      );
    });
    await this.mail.send(MailTemplates.passwordChanged(user.email, firstName(user.fullName)));
  }
}

const firstName = (fullName: string) => fullName.split(/\s+/)[0] ?? fullName;

const invalidLink = () =>
  new AppException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.INVALID_TOKEN,
    'This link is invalid or has expired. Please request a new one.',
  );

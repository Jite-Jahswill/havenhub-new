import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ErrorCode, type AuthTokens, type SessionView } from '@havenhub/shared';

import { AppException } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { ClientType, type Session, type User } from '../../generated/prisma/client';
import {
  composeSessionToken,
  generateSecret,
  parseSessionToken,
  safeEqualHex,
  sha256,
} from '../../infrastructure/crypto/tokens';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PlatformPoliciesService } from '../platform/platform-policies.service';

/** Concurrent refreshes (e.g. two tabs) within this window are not treated as theft. */
const REFRESH_REUSE_GRACE_MS = 30_000;
/** Avoid a database write on every request just to bump `lastUsedAt`. */
const LAST_USED_RESOLUTION_MS = 5 * 60_000;

export interface IssuedSession {
  session: Session;
  tokens: AuthTokens;
}

export type SessionRevocationReason =
  | 'logout'
  | 'logout_all'
  | 'revoked_by_user'
  | 'password_changed'
  | 'password_reset'
  | 'account_status_changed'
  | 'refresh_token_reuse';

/**
 * The single source of truth for sessions. Cookie (web) and bearer (mobile)
 * clients both authenticate against these rows; only the token transport
 * differs. Revoking a session immediately invalidates its access token.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
    private readonly policies: PlatformPoliciesService,
  ) {}

  async create(userId: string, clientType: ClientType, meta: RequestMeta): Promise<IssuedSession> {
    const accessSecret = generateSecret();
    const refreshSecret = generateSecret();
    const { accessExpiresAt, refreshExpiresAt } = await this.expiries();

    const session = await this.prisma.session.create({
      data: {
        userId,
        clientType,
        accessTokenHash: sha256(accessSecret),
        accessTokenExpiresAt: accessExpiresAt,
        refreshTokenHash: sha256(refreshSecret),
        expiresAt: refreshExpiresAt,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
    });

    return { session, tokens: this.tokens(session.id, accessSecret, refreshSecret, session) };
  }

  /** Resolves an access token to its active session and user, or `null`. */
  async authenticate(accessToken: string): Promise<(Session & { user: User }) | null> {
    const parsed = parseSessionToken(accessToken);
    if (!parsed) return null;

    const session = await this.prisma.session.findUnique({
      where: { id: parsed.sessionId },
      include: { user: true },
    });
    const now = Date.now();
    if (
      !session ||
      session.revokedAt ||
      session.accessTokenExpiresAt.getTime() <= now ||
      session.expiresAt.getTime() <= now ||
      !safeEqualHex(session.accessTokenHash, sha256(parsed.secret))
    ) {
      return null;
    }

    if (now - session.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
      await this.prisma.session
        .update({ where: { id: session.id }, data: { lastUsedAt: new Date(now) } })
        .catch(() => undefined);
    }
    return session;
  }

  /**
   * Rotates both tokens. A refresh token can be used exactly once; presenting
   * an already-rotated token outside the grace window revokes the session,
   * because it indicates the token was copied by someone else.
   */
  async rotate(refreshToken: string, clientType: ClientType, meta: RequestMeta) {
    const parsed = parseSessionToken(refreshToken);
    if (!parsed) throw sessionExpired();

    const session = await this.prisma.session.findUnique({
      where: { id: parsed.sessionId },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw sessionExpired();
    }
    if (session.clientType !== clientType) throw sessionExpired();

    const presentedHash = sha256(parsed.secret);
    if (!safeEqualHex(session.refreshTokenHash, presentedHash)) {
      const isPrevious =
        session.previousRefreshTokenHash !== null &&
        safeEqualHex(session.previousRefreshTokenHash, presentedHash);
      const withinGrace =
        session.refreshRotatedAt !== null &&
        Date.now() - session.refreshRotatedAt.getTime() < REFRESH_REUSE_GRACE_MS;

      if (isPrevious && !withinGrace) {
        this.logger.warn(`Refresh token reuse detected; revoking session ${session.id}`);
        await this.revoke(session.id, 'refresh_token_reuse');
      }
      throw sessionExpired();
    }

    const accessSecret = generateSecret();
    const refreshSecret = generateSecret();
    const { accessExpiresAt, refreshExpiresAt } = await this.expiries();

    // Conditional update: if two requests race with the same token, only one wins.
    const { count } = await this.prisma.session.updateMany({
      where: { id: session.id, refreshTokenHash: presentedHash, revokedAt: null },
      data: {
        accessTokenHash: sha256(accessSecret),
        accessTokenExpiresAt: accessExpiresAt,
        refreshTokenHash: sha256(refreshSecret),
        previousRefreshTokenHash: presentedHash,
        refreshRotatedAt: new Date(),
        expiresAt: refreshExpiresAt,
        lastUsedAt: new Date(),
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    });
    if (count !== 1) throw sessionExpired();

    const updated = {
      ...session,
      accessTokenExpiresAt: accessExpiresAt,
      expiresAt: refreshExpiresAt,
    };
    return {
      session: updated,
      user: session.user,
      tokens: this.tokens(session.id, accessSecret, refreshSecret, updated),
    };
  }

  /**
   * Finds the session behind an access or refresh token without requiring
   * the access token to be unexpired — used by logout.
   */
  async findByAnyToken(token: string): Promise<Session | null> {
    const parsed = parseSessionToken(token);
    if (!parsed) return null;
    const session = await this.prisma.session.findUnique({ where: { id: parsed.sessionId } });
    if (!session || session.revokedAt) return null;
    const hash = sha256(parsed.secret);
    const matches =
      safeEqualHex(session.accessTokenHash, hash) || safeEqualHex(session.refreshTokenHash, hash);
    return matches ? session : null;
  }

  async revoke(sessionId: string, reason: SessionRevocationReason): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  async revokeAllForUser(
    userId: string,
    reason: SessionRevocationReason,
    exceptSessionId?: string,
  ): Promise<number> {
    const { count } = await this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  }

  async listActive(userId: string, currentSessionId: string): Promise<SessionView[]> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      current: s.id === currentSessionId,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
    }));
  }

  /** Revokes one of the user's own sessions. Other users' sessions look like "not found". */
  async revokeOwn(userId: string, sessionId: string): Promise<void> {
    const { count } = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'revoked_by_user' },
    });
    if (count === 0)
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Session not found.');
  }

  /** The refresh lifetime (admin policy, else REFRESH_TOKEN_TTL_DAYS) restarts on every refresh. */
  private async expiries() {
    const days =
      (await this.policies.get()).security.sessionDays ?? this.env.REFRESH_TOKEN_TTL_DAYS;
    const now = Date.now();
    return {
      accessExpiresAt: new Date(now + this.env.ACCESS_TOKEN_TTL_MINUTES * 60_000),
      refreshExpiresAt: new Date(now + days * 86_400_000),
    };
  }

  private tokens(
    sessionId: string,
    accessSecret: string,
    refreshSecret: string,
    session: Pick<Session, 'accessTokenExpiresAt' | 'expiresAt'>,
  ): AuthTokens {
    return {
      accessToken: composeSessionToken(sessionId, accessSecret),
      accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
      refreshToken: composeSessionToken(sessionId, refreshSecret),
      refreshTokenExpiresAt: session.expiresAt.toISOString(),
    };
  }
}

const sessionExpired = () =>
  new AppException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.SESSION_EXPIRED,
    'Your session has expired. Please sign in again.',
  );

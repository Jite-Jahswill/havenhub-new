import { createHash } from 'node:crypto';

import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@havenhub/shared';
import type { Request, Response } from 'express';

import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { AppException } from '../errors/app.exception';
import { describeError } from '../logging/describe-error';
import { pathOf } from '../logging/request-context';
import { clientIp } from '../http/client-ip';
import { RATE_LIMIT, type RateLimitRule } from './rate-limit.decorator';

/**
 * Fixed-window rate limiting in Redis, shared across API instances. Applied
 * per route via `@RateLimit(...)`, in two layers:
 *
 *  - `RateLimitGuard` (before authentication): rules keyed by the canonical
 *    client IP and/or the submitted email — they protect unauthenticated
 *    endpoints and stop floods before any expensive work;
 *  - `UserRateLimitGuard` (right after authentication): `by: 'user'` rules,
 *    keyed by the signed-in user, so people sharing one public IP (carrier
 *    NAT) get their own quota and one user on several IPs shares theirs.
 *
 * If Redis is unavailable the request is allowed (and logged) so an outage
 * does not lock every user out.
 */
abstract class RateLimitLayer implements CanActivate {
  private readonly logger = new Logger('RateLimit');

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
    private readonly env: Env,
  ) {}

  /** Whether this layer handles the rule. */
  protected abstract handles(rule: RateLimitRule): boolean;
  /** The bucket identity for a rule, or undefined to skip it. */
  protected abstract identify(rule: RateLimitRule, req: Request): string | undefined;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.env.RATE_LIMIT_ENABLED || context.getType() !== 'http') return true;
    const rules = this.reflector
      .getAllAndOverride<RateLimitRule[] | undefined>(RATE_LIMIT, [
        context.getHandler(),
        context.getClass(),
      ])
      ?.filter((rule) => this.handles(rule));
    if (!rules?.length) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    for (const rule of rules) {
      const identity = this.identify(rule, req);
      if (!identity) continue;
      const key = `rl:${rule.name}:${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`;

      let count: number;
      let ttl: number;
      try {
        const results = await this.redis.client
          .multi()
          .incr(key)
          .expire(key, rule.windowSeconds, 'NX')
          .ttl(key)
          .exec();
        count = Number(results?.[0]?.[1] ?? 0);
        ttl = Number(results?.[2]?.[1] ?? rule.windowSeconds);
      } catch (error) {
        this.logger.warn('Rate limiter unavailable, allowing request', {
          event: 'rate_limit.unavailable',
          rule: rule.name,
          ...describeError(error),
        });
        return true;
      }

      if (count > rule.limit) {
        // The bucket identity (IP, email, user) is not logged.
        this.logger.warn('Rate limit exceeded', {
          event: 'rate_limit.exceeded',
          rule: rule.name,
          by: rule.by,
          method: req.method,
          path: pathOf(req),
          ...(req.auth ? { userId: req.auth.user.id } : {}),
        });
        res.setHeader('Retry-After', String(Math.max(ttl, 1)));
        throw new AppException(
          HttpStatus.TOO_MANY_REQUESTS,
          ErrorCode.RATE_LIMITED,
          'Too many attempts. Please wait a moment and try again.',
        );
      }
    }
    return true;
  }
}

/** IP / email rules, evaluated before authentication. */
@Injectable()
export class RateLimitGuard extends RateLimitLayer {
  constructor(reflector: Reflector, redis: RedisService, @Inject(ENV) env: Env) {
    super(reflector, redis, env);
  }

  protected handles(rule: RateLimitRule): boolean {
    return rule.by !== 'user';
  }

  protected identify(rule: RateLimitRule, req: Request): string | undefined {
    const ip = clientIp(req) ?? 'unknown';
    const rawEmail = (req.body as { email?: unknown } | undefined)?.email;
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : undefined;
    switch (rule.by) {
      case 'ip':
        return ip;
      case 'ip+email':
        return email ? `${ip}|${email}` : ip;
      case 'email':
        return email;
      default:
        return undefined;
    }
  }
}

/**
 * `by: 'user'` rules, evaluated after authentication. Callers without a
 * session (only possible on public routes) fall back to their canonical IP,
 * so these rules always apply.
 */
@Injectable()
export class UserRateLimitGuard extends RateLimitLayer {
  constructor(reflector: Reflector, redis: RedisService, @Inject(ENV) env: Env) {
    super(reflector, redis, env);
  }

  protected handles(rule: RateLimitRule): boolean {
    return rule.by === 'user';
  }

  protected identify(_rule: RateLimitRule, req: Request): string | undefined {
    return req.auth?.user.id ?? clientIp(req) ?? 'unknown';
  }
}

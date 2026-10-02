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
import { RATE_LIMIT, type RateLimitRule } from './rate-limit.decorator';

/**
 * Fixed-window rate limiting in Redis, shared across API instances. Applied
 * per route via `@RateLimit(...)`. If Redis is unavailable the request is
 * allowed (and logged) so an outage does not lock every user out.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.env.RATE_LIMIT_ENABLED) return true;
    const rules = this.reflector.getAllAndOverride<RateLimitRule[] | undefined>(RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
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
        this.logger.warn(`Rate limiter unavailable, allowing request: ${(error as Error).message}`);
        return true;
      }

      if (count > rule.limit) {
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

  private identify(rule: RateLimitRule, req: Request): string | undefined {
    const ip = req.ip ?? 'unknown';
    const rawEmail = (req.body as { email?: unknown } | undefined)?.email;
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : undefined;
    switch (rule.by) {
      case 'ip':
        return ip;
      case 'ip+email':
        return email ? `${ip}|${email}` : ip;
      case 'email':
        return email;
      case 'user':
        return req.auth?.user.id ?? ip;
    }
  }
}

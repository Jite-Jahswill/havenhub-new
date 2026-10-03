import {
  HttpStatus,
  Injectable,
  Logger,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccountType, ErrorCode, MAINTENANCE_RETRY_AFTER_SECONDS } from '@havenhub/shared';
import type { Request, Response } from 'express';

import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';

export const MAINTENANCE_EXEMPT = 'platform:maintenanceExempt';

/**
 * Keeps a route available during maintenance for everyone. The allowlist is
 * deliberately short: sign-in and account flows, health checks, payment
 * webhooks, the platform status the web app reads, public branding and
 * media. Administrators pass everywhere; background jobs are not HTTP and
 * are never affected.
 */
export const MaintenanceExempt = () => SetMetadata(MAINTENANCE_EXEMPT, true);

export interface MaintenanceState {
  enabled: boolean;
  message: string | null;
  returnText: string | null;
}

const STATE_KEY = 'platform:maintenance';
const STATE_TTL_SECONDS = 30;

/**
 * The maintenance switch, read on every request. Cached in Redis and
 * rewritten (not just expired) on every change, so all API instances see a
 * change immediately; without Redis it is read from the database.
 */
@Injectable()
export class MaintenanceStateService {
  private readonly logger = new Logger(MaintenanceStateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async state(): Promise<MaintenanceState> {
    try {
      const cached = await this.redis.client.get(STATE_KEY);
      if (cached) return JSON.parse(cached) as MaintenanceState;
    } catch {
      // Redis unavailable: use the database.
    }
    const state = await this.load();
    // NX: never overwrite a state published by a concurrent change.
    this.redis.client
      .set(STATE_KEY, JSON.stringify(state), 'EX', STATE_TTL_SECONDS, 'NX')
      .catch(() => undefined);
    return state;
  }

  /** Call after a committed change. */
  async publish(): Promise<void> {
    const state = await this.load();
    try {
      await this.redis.client.set(STATE_KEY, JSON.stringify(state), 'EX', STATE_TTL_SECONDS);
    } catch (error) {
      // Instances fall back to the database once the cached value expires.
      this.logger.warn(`Maintenance state not published: ${(error as Error).message}`);
      await this.redis.client.del(STATE_KEY).catch(() => undefined);
    }
  }

  private async load(): Promise<MaintenanceState> {
    const row = await this.prisma.platformSettings.findUnique({ where: { id: 1 } });
    return {
      enabled: row?.maintenanceEnabled ?? false,
      message: row?.maintenanceMessage ?? null,
      returnText: row?.maintenanceReturnText ?? null,
    };
  }
}

/**
 * Global guard (after authentication and authorization). While maintenance
 * is on, every request that is neither exempt nor made by an administrator
 * gets 503 with Retry-After. The flag comes only from the server.
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly maintenance: MaintenanceStateService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const exempt = this.reflector.getAllAndOverride<boolean>(MAINTENANCE_EXEMPT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (exempt) return true;
    const state = await this.maintenance.state();
    if (!state.enabled) return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (req.auth?.user.accountType === AccountType.ADMIN) return true;

    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Retry-After', String(MAINTENANCE_RETRY_AFTER_SECONDS));
    throw new AppException(
      HttpStatus.SERVICE_UNAVAILABLE,
      ErrorCode.MAINTENANCE_MODE,
      state.message ?? 'HavenHub is down for maintenance. Please try again soon.',
    );
  }
}

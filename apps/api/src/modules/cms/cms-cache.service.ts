import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../infrastructure/redis/redis.service';
import { RevalidationService } from './revalidation.service';

const VERSION_KEY = 'cms:version';

/**
 * Short-lived Redis cache for public CMS reads. Every admin write bumps one
 * version counter, which invalidates every cached entry at once (no key
 * scans), and asks the web app to revalidate. If Redis is unavailable the
 * data is simply loaded from the database.
 */
@Injectable()
export class CmsCacheService {
  private readonly logger = new Logger(CmsCacheService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly revalidation: RevalidationService,
  ) {}

  async get<T>(name: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    let key: string | null = null;
    try {
      const version = (await this.redis.client.get(VERSION_KEY)) ?? '0';
      key = `cms:${version}:${name}`;
      const hit = await this.redis.client.get(key);
      if (hit) return JSON.parse(hit) as T;
    } catch (error) {
      this.logger.warn(`CMS cache read failed: ${(error as Error).message}`);
    }
    const value = await load();
    if (key) {
      this.redis.client
        .set(key, JSON.stringify(value), 'EX', ttlSeconds)
        .catch((error: Error) => this.logger.warn(`CMS cache write failed: ${error.message}`));
    }
    return value;
  }

  /** Call after every committed CMS change. */
  async invalidate(): Promise<void> {
    try {
      await this.redis.client.incr(VERSION_KEY);
    } catch (error) {
      this.logger.warn(`CMS cache invalidation failed: ${(error as Error).message}`);
    }
    this.revalidation.trigger();
  }
}

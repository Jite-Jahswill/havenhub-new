import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from './redis.service';

const KEY_PREFIX = 'havenhub:lock:';

// Release / renew only while we still own the lock: a holder whose lease
// lapsed must never delete or extend the lease of whoever took over.
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
const RENEW = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;

export interface LockHandle {
  readonly key: string;
  readonly token: string;
  /** Extends the lease. False when the lock was lost (lapsed and taken over). */
  renew(): Promise<boolean>;
  /** Releases the lock if still owned. Safe to call more than once. */
  release(): Promise<void>;
}

export type LockedRun<T> = { acquired: true; result: T } | { acquired: false };

/**
 * Single-holder leases in Redis (`SET key token NX PX ttl`), used so that only
 * one API instance runs a scheduled job at a time.
 *
 * Every lease expires on its own, so a crashed holder blocks the job for at
 * most `ttlMs`. A lease is a mutual-exclusion *optimisation*, not the safety
 * net: the work done under it must stay idempotent (row locks + status
 * re-checks), because a paused holder can outlive its lease.
 */
@Injectable()
export class DistributedLockService {
  private readonly logger = new Logger(DistributedLockService.name);

  constructor(private readonly redis: RedisService) {}

  /** Takes the lock, or returns null if another holder has it. Throws if Redis is unreachable. */
  async tryAcquire(name: string, ttlMs: number): Promise<LockHandle | null> {
    const key = KEY_PREFIX + name;
    const token = randomUUID();
    const ok = await this.redis.client.set(key, token, 'PX', ttlMs, 'NX');
    if (ok !== 'OK') return null;
    const client = this.redis.client;
    return {
      key,
      token,
      renew: async () => (await client.eval(RENEW, 1, key, token, ttlMs)) === 1,
      release: async () => {
        await client.eval(RELEASE, 1, key, token);
      },
    };
  }

  /**
   * Runs `fn` while holding the lock, renewing the lease every `ttlMs / 3`.
   * Returns `{ acquired: false }` without running `fn` if the lock is taken.
   * The lock is released when `fn` settles, including when it throws.
   */
  async withLock<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<LockedRun<T>> {
    const lock = await this.tryAcquire(name, ttlMs);
    if (!lock) return { acquired: false };
    const heartbeat = setInterval(
      () => {
        lock.renew().then(
          (owned) => {
            if (!owned)
              this.logger.warn(`Lost lock ${name} while running; continuing idempotently`);
          },
          (error: Error) => this.logger.warn(`Could not renew lock ${name}: ${error.message}`),
        );
      },
      Math.max(1, Math.floor(ttlMs / 3)),
    );
    heartbeat.unref();
    try {
      return { acquired: true, result: await fn() };
    } finally {
      clearInterval(heartbeat);
      // If Redis is down the lease simply expires.
      await lock.release().catch((error: Error) => {
        this.logger.warn(`Could not release lock ${name}: ${error.message}`);
      });
    }
  }
}

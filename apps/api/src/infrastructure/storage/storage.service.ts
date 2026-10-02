import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { STORAGE_DRIVER, type StorageDriver } from './storage.types';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly baseUrl: string;

  constructor(
    @Inject(STORAGE_DRIVER) readonly driver: StorageDriver,
    @Inject(ENV) env: Env,
  ) {
    this.baseUrl = env.STORAGE_PUBLIC_BASE_URL.replace(/\/$/, '');
  }

  /** e.g. `properties/<propertyId>/<uuid>-lg.webp` — unguessable and immutable. */
  newKey(prefix: string, suffix: string, ext = 'webp'): string {
    return `${prefix}/${randomUUID()}-${suffix}.${ext}`;
  }

  put(key: string, body: Buffer, contentType: string): Promise<void> {
    return this.driver.put(key, body, contentType);
  }

  /** Best-effort: a failed delete leaves an orphan object, never a broken row. */
  async deleteQuietly(...keys: string[]): Promise<void> {
    await Promise.all(
      keys.map((key) =>
        this.driver.delete(key).catch((error: unknown) => {
          this.logger.warn(`Could not delete ${key}: ${(error as Error).message}`);
        }),
      ),
    );
  }

  url(key: string): string;
  url(key: string | null | undefined): string | null;
  url(key: string | null | undefined): string | null {
    return key ? `${this.baseUrl}/${key}` : null;
  }
}

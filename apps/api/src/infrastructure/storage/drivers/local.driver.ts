import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import {
  CONTENT_TYPES,
  assertSafeKey,
  type StorageDriver,
  type StoredObject,
} from '../storage.types';

/**
 * Development storage on local disk, served by the API's `/api/media` route.
 * Not for production: container disks are ephemeral and not shared between
 * instances (env validation enforces this).
 */
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local' as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async read(key: string): Promise<StoredObject | null> {
    const path = this.pathFor(key);
    try {
      const info = await stat(path);
      if (!info.isFile()) return null;
      const ext = key.slice(key.lastIndexOf('.') + 1);
      return {
        body: createReadStream(path),
        contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream',
        size: info.size,
      };
    } catch {
      return null;
    }
  }

  private pathFor(key: string): string {
    assertSafeKey(key);
    const path = resolve(join(this.root, key));
    if (!path.startsWith(this.root + sep)) throw new Error('Path escapes storage root');
    return path;
  }
}

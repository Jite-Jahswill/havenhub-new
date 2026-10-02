import type { Readable } from 'node:stream';

export interface StoredObject {
  body: Readable;
  contentType: string;
  size: number;
}

/**
 * Object storage abstraction. The application only ever stores *keys*;
 * public URLs are derived at read time, so moving to a CDN or another
 * provider never requires rewriting database rows.
 */
export interface StorageDriver {
  readonly name: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Only the local driver serves files itself; S3 objects are fetched from the bucket/CDN. */
  read?(key: string): Promise<StoredObject | null>;
}

export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');

/** Keys are generated server-side; this guards every driver against traversal. */
export const SAFE_STORAGE_KEY = /^(?!.*\.\.)[a-z0-9][a-z0-9/_-]*\.(webp|jpg|png)$/;

export function assertSafeKey(key: string): void {
  if (!SAFE_STORAGE_KEY.test(key)) throw new Error(`Unsafe storage key: ${key}`);
}

export const CONTENT_TYPES: Record<string, string> = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  png: 'image/png',
};

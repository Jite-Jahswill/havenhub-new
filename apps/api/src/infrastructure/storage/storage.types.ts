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
  /**
   * Streams an object. Public files are served by the bucket/CDN (S3) or the
   * media route (local); private files are always streamed through the API.
   */
  read(key: string): Promise<StoredObject | null>;
}

export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');

/** Keys are generated server-side; this guards every driver against traversal. */
export const SAFE_STORAGE_KEY = /^(?!.*\.\.)[a-z0-9][a-z0-9/_-]*\.(webp|jpg|png)$/;

/**
 * Private objects (chat attachments). Never served by the public media route
 * or a public bucket URL — only streamed by an API endpoint that checks who
 * is asking. With S3, keep the `chat/` prefix out of any public-read policy.
 */
export const PRIVATE_PREFIX = 'chat/';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const SAFE_PRIVATE_KEY = new RegExp(
  `^chat/${UUID}/${UUID}(-[a-z]+)?\\.(webp|mp4|mov|webm|mp3|m4a|ogg|wav|pdf|docx|xlsx|pptx|txt|csv)$`,
);

/** Keys the public media route may serve. */
export const isPublicKey = (key: string) =>
  SAFE_STORAGE_KEY.test(key) && !key.startsWith(PRIVATE_PREFIX);

export function assertSafeKey(key: string): void {
  if (!isPublicKey(key) && !SAFE_PRIVATE_KEY.test(key)) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}

export const CONTENT_TYPES: Record<string, string> = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  png: 'image/png',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
};

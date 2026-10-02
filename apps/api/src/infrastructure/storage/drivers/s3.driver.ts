import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { Env } from '../../../config/env';
import { assertSafeKey, type StorageDriver } from '../storage.types';

/**
 * Any S3-compatible store (AWS S3, Cloudflare R2, Backblaze B2, MinIO…).
 * Objects are immutable (keys are unique per upload), so long cache lifetimes are safe.
 */
export class S3StorageDriver implements StorageDriver {
  readonly name = 's3' as const;

  constructor(
    private readonly bucket: string,
    private readonly client: Pick<S3Client, 'send'>,
  ) {}

  static fromEnv(env: Env): S3StorageDriver {
    const client = new S3Client({
      region: env.STORAGE_REGION,
      endpoint: env.STORAGE_ENDPOINT,
      forcePathStyle: env.STORAGE_FORCE_PATH_STYLE ?? Boolean(env.STORAGE_ENDPOINT),
      credentials: {
        accessKeyId: env.STORAGE_ACCESS_KEY!,
        secretAccessKey: env.STORAGE_SECRET_KEY!,
      },
    });
    return new S3StorageDriver(env.STORAGE_BUCKET!, client);
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

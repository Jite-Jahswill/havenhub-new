import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '@havenhub/shared';
import sharp, { type Metadata } from 'sharp';

import { AppException } from '../../common/errors/app.exception';
import { PlatformPoliciesService } from '../../modules/platform/platform-policies.service';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'heif']);
const MAX_INPUT_PIXELS = 50_000_000;

export interface Rendition {
  buffer: Buffer;
  width: number;
  height: number;
}

/**
 * Decodes and re-encodes every uploaded image. The file type is decided by
 * actually decoding it (never by name or client MIME type); re-encoding
 * strips EXIF/GPS metadata and neutralises polyglot files.
 */
@Injectable()
export class ImageProcessor {
  constructor(private readonly policies: PlatformPoliciesService) {}

  async listingRenditions(input: Buffer): Promise<{ large: Rendition; thumbnail: Rendition }> {
    await this.inspect(input);
    const [large, thumbnail] = await Promise.all([
      this.render(input, 2000, 82),
      this.render(input, 640, 74),
    ]);
    return { large, thumbnail };
  }

  /** Chat photos: any size, re-encoded for display plus a thumbnail. */
  async chatRenditions(input: Buffer): Promise<{ display: Rendition; thumbnail: Rendition }> {
    // The chat attachment policy limits these (AttachmentsService), not the image policy.
    await this.inspect(input, { minWidth: 1, minHeight: 1 }, false);
    const [display, thumbnail] = await Promise.all([
      this.render(input, 1600, 80),
      this.render(input, 480, 72),
    ]);
    return { display, thumbnail };
  }

  /** CMS content images (any size from 16 px), plus a thumbnail. */
  async cmsRenditions(input: Buffer): Promise<{ large: Rendition; thumbnail: Rendition }> {
    await this.inspect(input, { minWidth: 16, minHeight: 16 });
    const [large, thumbnail] = await Promise.all([
      this.render(input, 2000, 82),
      this.render(input, 480, 74),
    ]);
    return { large, thumbnail };
  }

  /** Site logo: fits within 800 × 240, transparency kept (WebP). */
  async logo(input: Buffer): Promise<Rendition> {
    await this.inspect(input, { minWidth: 16, minHeight: 16 });
    const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(800, 240, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 90, alphaQuality: 100 })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height };
  }

  /** Favicon: a 64 × 64 PNG on a transparent background. */
  async favicon(input: Buffer): Promise<Rendition> {
    await this.inspect(input, { minWidth: 16, minHeight: 16 });
    const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height };
  }

  async avatar(input: Buffer): Promise<Rendition> {
    await this.inspect(input);
    const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(400, 400, { fit: 'cover', position: 'attention' })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height };
  }

  private async inspect(
    input: Buffer,
    min: { minWidth: number; minHeight: number } = { minWidth: 320, minHeight: 240 },
    applyPolicy = true,
  ): Promise<void> {
    if (input.length === 0) throw invalidFile('The file is empty.');
    // MAX_IMAGE_BYTES is the hard ceiling (the upload parser stops there); admins may set less.
    const maxMb = applyPolicy
      ? (await this.policies.get()).storage.imageMaxMb
      : MAX_IMAGE_BYTES / (1024 * 1024);
    if (input.length > Math.min(MAX_IMAGE_BYTES, maxMb * 1024 * 1024)) {
      throw invalidFile(`Images must be ${maxMb} MB or smaller.`);
    }
    let meta: Metadata;
    try {
      meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    } catch {
      throw invalidFile('This file is not a supported image.');
    }
    const { format, width = 0, height = 0 } = meta;
    if (!format || !ACCEPTED_FORMATS.has(format)) {
      throw invalidFile('Upload a JPEG, PNG, WebP or AVIF image.');
    }
    if (width < min.minWidth || height < min.minHeight) {
      throw invalidFile(`Images must be at least ${min.minWidth} × ${min.minHeight} pixels.`);
    }
  }

  private async render(input: Buffer, size: number, quality: number): Promise<Rendition> {
    const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height };
  }
}

const invalidFile = (message: string) =>
  new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.INVALID_FILE, message);

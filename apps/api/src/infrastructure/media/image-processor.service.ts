import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '@havenhub/shared';
import sharp, { type Metadata } from 'sharp';

import { AppException } from '../../common/errors/app.exception';

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
  async listingRenditions(input: Buffer): Promise<{ large: Rendition; thumbnail: Rendition }> {
    await this.inspect(input);
    const [large, thumbnail] = await Promise.all([
      this.render(input, 2000, 82),
      this.render(input, 640, 74),
    ]);
    return { large, thumbnail };
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

  private async inspect(input: Buffer): Promise<void> {
    if (input.length === 0) throw invalidFile('The file is empty.');
    if (input.length > MAX_IMAGE_BYTES) throw invalidFile('Images must be 10 MB or smaller.');
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
    if (width < 320 || height < 240) throw invalidFile('Images must be at least 320 × 240 pixels.');
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

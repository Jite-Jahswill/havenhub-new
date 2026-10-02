import { HttpStatus, UseInterceptors, applyDecorators } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ErrorCode } from '@havenhub/shared';
import { memoryStorage } from 'multer';

import { MAX_IMAGE_BYTES } from '../../infrastructure/media/image-processor.service';
import { AppException } from '../errors/app.exception';

/**
 * Accepts exactly one file in the `file` field, held in memory and capped at
 * MAX_IMAGE_BYTES before it is ever decoded. The content is validated by
 * ImageProcessor, never trusted from the client.
 */
export const ImageUpload = () =>
  applyDecorators(
    UseInterceptors(
      FileInterceptor('file', {
        storage: memoryStorage(),
        limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 5, parts: 6 },
      }),
    ),
  );

export function requireFile(file: Express.Multer.File | undefined): Express.Multer.File {
  if (!file) {
    throw new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      ErrorCode.INVALID_FILE,
      'Choose an image to upload.',
    );
  }
  return file;
}

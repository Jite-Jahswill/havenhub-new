import { UseInterceptors, applyDecorators } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MAX_ATTACHMENT_BYTES } from '@havenhub/shared';
import { memoryStorage } from 'multer';

/**
 * One chat file in the `file` field, held in memory and capped at the
 * largest per-kind limit before it is inspected; the per-kind limit and the
 * real type are then checked by AttachmentsService.
 */
export const ChatUpload = () =>
  applyDecorators(
    UseInterceptors(
      FileInterceptor('file', {
        storage: memoryStorage(),
        limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1, fields: 2, parts: 3 },
      }),
    ),
  );

import { UseInterceptors, applyDecorators } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CMS_LIMITS } from '@havenhub/shared';
import { memoryStorage } from 'multer';

/** A job application: text fields plus one CV in `cv`, capped at the CV limit. */
export const CvUpload = () =>
  applyDecorators(
    UseInterceptors(
      FileInterceptor('cv', {
        storage: memoryStorage(),
        limits: { fileSize: CMS_LIMITS.cvBytes, files: 1, fields: 8, parts: 9, fieldSize: 16_384 },
      }),
    ),
  );

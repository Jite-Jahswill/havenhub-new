import { Controller, Get, Param, Res, VERSION_NEUTRAL } from '@nestjs/common';
import type { Response } from 'express';

import { Errors } from '../../common/errors/app.exception';
import { Public } from '../../modules/auth/decorators/auth.decorators';
import { MaintenanceExempt } from '../../modules/platform/maintenance';
import { StorageService } from './storage.service';
import { isPublicKey } from './storage.types';

/**
 * Serves files for the local storage driver: `GET /api/media/<key>`.
 * With S3, clients load files from the bucket/CDN and this route 404s.
 */
@Public()
@MaintenanceExempt()
@Controller({ path: 'media', version: VERSION_NEUTRAL })
export class MediaController {
  constructor(private readonly storage: StorageService) {}

  @Get('*key')
  async serve(@Param('key') key: string | string[], @Res() res: Response): Promise<void> {
    const path = Array.isArray(key) ? key.join('/') : key;
    // Private objects (chat/) are never served here; with S3 this route always 404s.
    if (!isPublicKey(path) || this.storage.driver.name !== 'local') throw Errors.notFound('File');
    const file = await this.storage.driver.read(path);
    if (!file) throw Errors.notFound('File');

    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    file.body.pipe(res);
  }
}

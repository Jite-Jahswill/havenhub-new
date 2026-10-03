import { Controller, Get, HttpCode, HttpStatus, Res, VERSION_NEUTRAL } from '@nestjs/common';
import type { ApiSuccess, HealthCheck } from '@havenhub/shared';
import type { Response } from 'express';

import { Public } from '../auth/decorators/auth.decorators';
import { MaintenanceExempt } from '../platform/maintenance';
import { HealthService } from './health.service';

/**
 * `GET /api/health/live`  — process is up (container liveness probe).
 * `GET /api/health`       — process plus PostgreSQL and Redis (readiness);
 *                           responds 503 when any dependency is down.
 */
@Public()
@MaintenanceExempt()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @HttpCode(HttpStatus.OK)
  live(): ApiSuccess<{ status: 'ok' }> {
    return { success: true, data: { status: 'ok' } };
  }

  @Get()
  async readiness(@Res({ passthrough: true }) res: Response): Promise<ApiSuccess<HealthCheck>> {
    const result = await this.health.check();
    res.status(result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { success: true, data: result };
  }
}

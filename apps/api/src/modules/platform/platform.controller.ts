import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import {
  AccountType,
  updateMaintenanceSchema,
  updateModerationPolicySchema,
  updateSmtpSettingsSchema,
} from '@havenhub/shared';
import type { Request } from 'express';
import type { z } from 'zod';

import { requestMeta } from '../../common/http/request-meta';
import { ok } from '../../common/http/response';
import { validate } from '../../common/pipes/zod-validation.pipe';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import type { AuthContext } from '../auth/auth.types';
import {
  AccountTypes,
  CurrentAuth,
  Public,
  RequirePermissions,
  RequireVerifiedEmail,
} from '../auth/decorators/auth.decorators';
import { MaintenanceExempt } from './maintenance';
import { PlatformSettingsService } from './platform-settings.service';
import { SmtpSettingsService } from './smtp-settings.service';

/** Public platform state (the web app checks it before rendering pages). */
@Public()
@MaintenanceExempt()
@Controller('platform')
export class PlatformStatusController {
  constructor(private readonly platform: PlatformSettingsService) {}

  @Get('status')
  async status() {
    return ok(await this.platform.status());
  }
}

/** Platform configuration. Each area has its own permission. */
@Controller('admin/settings')
@AccountTypes(AccountType.ADMIN)
@RequireVerifiedEmail()
export class AdminSettingsController {
  constructor(
    private readonly platform: PlatformSettingsService,
    private readonly smtp: SmtpSettingsService,
  ) {}

  // ── Maintenance ──

  @Get('maintenance')
  @RequirePermissions('settings.maintenance')
  async maintenance() {
    return ok(await this.platform.view());
  }

  @Patch('maintenance')
  @RequirePermissions('settings.maintenance')
  async updateMaintenance(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(updateMaintenanceSchema)) body: z.output<typeof updateMaintenanceSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.platform.updateMaintenance(auth, body, requestMeta(req)));
  }

  // ── Moderation policy ──

  @Get('moderation')
  @RequirePermissions('settings.manage')
  async moderation() {
    return ok(await this.platform.view());
  }

  @Patch('moderation')
  @RequirePermissions('settings.manage')
  async updateModeration(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(updateModerationPolicySchema))
    body: z.output<typeof updateModerationPolicySchema>,
    @Req() req: Request,
  ) {
    return ok(await this.platform.updateModeration(auth, body, requestMeta(req)));
  }

  // ── SMTP ──

  @Get('smtp')
  @RequirePermissions('settings.smtp')
  async smtpSettings() {
    return ok(await this.smtp.view());
  }

  @Put('smtp')
  @RequirePermissions('settings.smtp')
  async updateSmtp(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(updateSmtpSettingsSchema)) body: z.output<typeof updateSmtpSettingsSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.smtp.update(auth, body, requestMeta(req)));
  }

  @Delete('smtp')
  @RequirePermissions('settings.smtp')
  async removeSmtp(@CurrentAuth() auth: AuthContext, @Req() req: Request) {
    return ok(await this.smtp.remove(auth, requestMeta(req)));
  }

  @Post('smtp/test')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('settings.smtp')
  @RateLimit({ name: 'smtp-test:user', limit: 5, windowSeconds: 600, by: 'user' })
  async testSmtp(@CurrentAuth() auth: AuthContext, @Req() req: Request) {
    return ok(await this.smtp.test(auth, requestMeta(req)));
  }
}

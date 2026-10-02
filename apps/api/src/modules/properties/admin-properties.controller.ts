import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req } from '@nestjs/common';
import {
  AccountType,
  adminListPropertiesQuerySchema,
  adminModeratePropertySchema,
} from '@havenhub/shared';
import type { Request } from 'express';
import type { z } from 'zod';

import { requestMeta } from '../../common/http/request-meta';
import { ok } from '../../common/http/response';
import { validate } from '../../common/pipes/zod-validation.pipe';
import type { AuthContext } from '../auth/auth.types';
import {
  AccountTypes,
  CurrentAuth,
  RequirePermissions,
  RequireVerifiedEmail,
} from '../auth/decorators/auth.decorators';
import { PropertyModerationService } from './property-moderation.service';

@Controller('admin/properties')
@AccountTypes(AccountType.ADMIN)
@RequireVerifiedEmail()
export class AdminPropertiesController {
  constructor(private readonly moderation: PropertyModerationService) {}

  @Get()
  @RequirePermissions('properties.view')
  async list(
    @Query(validate(adminListPropertiesQuerySchema))
    query: z.output<typeof adminListPropertiesQuerySchema>,
  ) {
    return ok(await this.moderation.list(query));
  }

  @Get(':id')
  @RequirePermissions('properties.view')
  async get(@Param('id', new ParseUUIDPipe()) id: string) {
    return ok(await this.moderation.get(id));
  }

  /** Approve, reject (reason required), suspend (reason required) or restore. Always audited. */
  @Patch(':id/moderation')
  @RequirePermissions('properties.view', 'properties.approve')
  async moderate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(validate(adminModeratePropertySchema)) body: z.output<typeof adminModeratePropertySchema>,
    @Req() req: Request,
  ) {
    return ok(await this.moderation.moderate(auth, id, body, requestMeta(req)));
  }
}

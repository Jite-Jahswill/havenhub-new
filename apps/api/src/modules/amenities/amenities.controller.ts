import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { AccountType, createAmenitySchema, updateAmenitySchema } from '@havenhub/shared';
import type { Request } from 'express';
import type { z } from 'zod';

import { requestMeta } from '../../common/http/request-meta';
import { ok } from '../../common/http/response';
import { validate } from '../../common/pipes/zod-validation.pipe';
import type { AuthContext } from '../auth/auth.types';
import {
  AccountTypes,
  CurrentAuth,
  Public,
  RequirePermissions,
  RequireVerifiedEmail,
} from '../auth/decorators/auth.decorators';
import { AmenitiesService } from './amenities.service';

/** Active amenities, for listing forms and search filters. */
@Public()
@Controller('amenities')
export class AmenitiesController {
  constructor(private readonly amenities: AmenitiesService) {}

  @Get()
  async list() {
    return ok(await this.amenities.listActive());
  }
}

@Controller('admin/amenities')
@AccountTypes(AccountType.ADMIN)
@RequireVerifiedEmail()
@RequirePermissions('amenities.manage')
export class AdminAmenitiesController {
  constructor(private readonly amenities: AmenitiesService) {}

  @Get()
  async list() {
    return ok(await this.amenities.adminList());
  }

  @Post()
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(createAmenitySchema)) body: z.output<typeof createAmenitySchema>,
    @Req() req: Request,
  ) {
    return ok(await this.amenities.create(auth.user.id, body, requestMeta(req)));
  }

  @Patch(':id')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(validate(updateAmenitySchema)) body: z.output<typeof updateAmenitySchema>,
    @Req() req: Request,
  ) {
    return ok(await this.amenities.update(auth.user.id, id, body, requestMeta(req)));
  }
}

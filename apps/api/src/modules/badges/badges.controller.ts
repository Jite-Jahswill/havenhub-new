import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  AccountType,
  badgeAssignmentSchema,
  createBadgeSchema,
  updateBadgeSchema,
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
import { BadgesService } from './badges.service';

type Out<T extends z.ZodType> = z.output<T>;
const uuid = new ParseUUIDPipe();

@Controller('admin/badges')
@AccountTypes(AccountType.ADMIN)
@RequireVerifiedEmail()
@RequirePermissions('badges.manage')
export class AdminBadgesController {
  constructor(private readonly badges: BadgesService) {}

  @Get()
  async list() {
    return ok(await this.badges.list());
  }

  @Post()
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(createBadgeSchema)) body: Out<typeof createBadgeSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.badges.create(auth.user.id, body, requestMeta(req)));
  }

  @Get(':id')
  async get(@Param('id', uuid) id: string) {
    return ok(await this.badges.get(id));
  }

  @Patch(':id')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(updateBadgeSchema)) body: Out<typeof updateBadgeSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.badges.update(auth.user.id, id, body, requestMeta(req)));
  }

  @Delete(':id')
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.badges.remove(auth.user.id, id, requestMeta(req)));
  }

  /** Gives the badge to a property by hand. */
  @Post(':id/properties')
  async assign(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(badgeAssignmentSchema)) body: Out<typeof badgeAssignmentSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.badges.assign(auth.user.id, id, body.property, requestMeta(req)));
  }

  @Delete(':id/properties/:propertyId')
  async unassign(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Param('propertyId', uuid) propertyId: string,
    @Req() req: Request,
  ) {
    return ok(await this.badges.unassign(auth.user.id, id, propertyId, requestMeta(req)));
  }
}

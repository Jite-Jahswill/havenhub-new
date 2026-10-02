import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  AccountType,
  adminListSubscriptionsQuerySchema,
  adminSubscriptionActionSchema,
  createSubscriptionPlanSchema,
  setSubscriptionPlanStatusSchema,
  updateSubscriptionPlanSchema,
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
import { SubscriptionAdminService } from './subscription-admin.service';
import { SubscriptionPlansService } from './subscription-plans.service';

/** Plan configuration. Reading needs `subscriptions.view`; changes need `subscriptions.plans`. */
@Controller('admin/subscription-plans')
@AccountTypes(AccountType.ADMIN)
@RequireVerifiedEmail()
export class AdminSubscriptionPlansController {
  constructor(private readonly plans: SubscriptionPlansService) {}

  @Get()
  @RequirePermissions('subscriptions.view')
  async list() {
    return ok(await this.plans.adminList());
  }

  @Get(':id')
  @RequirePermissions('subscriptions.view')
  async get(@Param('id', new ParseUUIDPipe()) id: string) {
    return ok(await this.plans.adminGet(id));
  }

  @Post()
  @RequirePermissions('subscriptions.view', 'subscriptions.plans')
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(createSubscriptionPlanSchema))
    body: z.output<typeof createSubscriptionPlanSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.plans.create(auth.user.id, body, requestMeta(req)));
  }

  @Patch(':id')
  @RequirePermissions('subscriptions.view', 'subscriptions.plans')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(validate(updateSubscriptionPlanSchema))
    body: z.output<typeof updateSubscriptionPlanSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.plans.update(auth.user.id, id, body, requestMeta(req)));
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('subscriptions.view', 'subscriptions.plans')
  async setStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(validate(setSubscriptionPlanStatusSchema))
    body: z.output<typeof setSubscriptionPlanStatusSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.plans.setStatus(auth.user.id, id, body.status, requestMeta(req)));
  }

  /** Only for plans nobody has ever paid for; otherwise archive. */
  @Delete(':id')
  @RequirePermissions('subscriptions.view', 'subscriptions.plans')
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    await this.plans.delete(auth.user.id, id, requestMeta(req));
    return ok({ deleted: true });
  }
}

@Controller('admin/subscriptions')
@AccountTypes(AccountType.ADMIN)
@RequireVerifiedEmail()
export class AdminSubscriptionsController {
  constructor(private readonly admin: SubscriptionAdminService) {}

  @Get()
  @RequirePermissions('subscriptions.view')
  async list(
    @Query(validate(adminListSubscriptionsQuerySchema))
    query: z.output<typeof adminListSubscriptionsQuerySchema>,
  ) {
    return ok(await this.admin.list(query));
  }

  @Get('stats')
  @RequirePermissions('subscriptions.view')
  async stats() {
    return ok(await this.admin.stats());
  }

  @Get(':id')
  @RequirePermissions('subscriptions.view')
  async detail(@Param('id', new ParseUUIDPipe()) id: string) {
    return ok(await this.admin.detail(id));
  }

  /** Cancel, suspend or reactivate. Always with a reason; always audited. */
  @Post(':id/actions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('subscriptions.view', 'subscriptions.manage')
  async act(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(validate(adminSubscriptionActionSchema))
    body: z.output<typeof adminSubscriptionActionSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.admin.act(auth.user.id, id, body, requestMeta(req)));
  }
}

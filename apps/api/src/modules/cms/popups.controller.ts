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
  createPopupSchema,
  popupEventSchema,
  popupListQuerySchema,
  updatePopupSchema,
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
  SkipCsrf,
} from '../auth/decorators/auth.decorators';
import { PopupsService } from './popups.service';

type Out<T extends z.ZodType> = z.output<T>;
const uuid = new ParseUUIDPipe();

/** What the public site may show, and anonymous view/click/close counts. */
@Public()
@Controller('popups')
export class PublicPopupsController {
  constructor(private readonly popups: PopupsService) {}

  @Get()
  async list() {
    return ok(await this.popups.publicList());
  }

  /** A counter only: no session or CSRF token needed, rate-limited per visitor. */
  @Post(':id/events')
  @SkipCsrf()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ name: 'popup-event:ip', limit: 60, windowSeconds: 60, by: 'ip' })
  async event(
    @Param('id', uuid) id: string,
    @Body(validate(popupEventSchema)) body: Out<typeof popupEventSchema>,
  ) {
    await this.popups.record(id, body);
  }
}

@Controller('admin/popups')
@AccountTypes(AccountType.ADMIN)
@RequireVerifiedEmail()
@RequirePermissions('popups.manage')
export class AdminPopupsController {
  constructor(private readonly popups: PopupsService) {}

  @Get()
  async list(@Query(validate(popupListQuerySchema)) query: Out<typeof popupListQuerySchema>) {
    return ok(await this.popups.list(query.page, query.pageSize));
  }

  @Post()
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(createPopupSchema)) body: Out<typeof createPopupSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.popups.create(auth.user.id, body, requestMeta(req)));
  }

  @Get(':id')
  async get(@Param('id', uuid) id: string) {
    return ok(await this.popups.get(id));
  }

  @Patch(':id')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(updatePopupSchema)) body: Out<typeof updatePopupSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.popups.update(auth.user.id, id, body, requestMeta(req)));
  }

  @Delete(':id')
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.popups.remove(auth.user.id, id, requestMeta(req)));
  }
}

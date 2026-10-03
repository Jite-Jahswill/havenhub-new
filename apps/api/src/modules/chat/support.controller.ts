import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { AccountType, adminSupportListQuerySchema } from '@havenhub/shared';
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
import { SupportService } from './support.service';

/** The support queue: list support requests and join one to answer it. */
@Controller('admin/support')
@AccountTypes(AccountType.ADMIN)
@RequireVerifiedEmail()
@RequirePermissions('support.respond')
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get('conversations')
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query(validate(adminSupportListQuerySchema))
    query: z.output<typeof adminSupportListQuerySchema>,
  ) {
    return ok(await this.support.list(auth.user.id, query));
  }

  @Post('conversations/:id/join')
  @HttpCode(HttpStatus.OK)
  async join(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.support.join(auth.user, id, requestMeta(req)));
  }
}

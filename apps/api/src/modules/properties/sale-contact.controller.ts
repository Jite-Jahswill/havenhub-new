import { Body, Controller, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { AccountType, acceptSaleContactSchema } from '@havenhub/shared';
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
  RequireVerifiedEmail,
} from '../auth/decorators/auth.decorators';
import { SaleContactService } from './sale-contact.service';

/** Contact for sale: signed-in buyers only, so every acceptance has a person behind it. */
@Controller('properties')
@AccountTypes(AccountType.CUSTOMER, AccountType.AGENT)
@RequireVerifiedEmail()
export class SaleContactController {
  constructor(private readonly saleContact: SaleContactService) {}

  @Post(':slug/sale-contact')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'sale-contact:user', limit: 30, windowSeconds: 3600, by: 'user' })
  async reveal(
    @CurrentAuth() auth: AuthContext,
    @Param('slug') slug: string,
    @Body(validate(acceptSaleContactSchema)) body: z.output<typeof acceptSaleContactSchema>,
    @Req() req: Request,
  ) {
    return ok(
      await this.saleContact.reveal(auth.user.id, slug.slice(0, 160), body, requestMeta(req)),
    );
  }
}

import {
  Body,
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
import {
  AccountType,
  adminReviewListQuerySchema,
  createReviewSchema,
  hideReviewSchema,
  propertyReviewsQuerySchema,
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
import { ReviewsService } from './reviews.service';

type Out<T extends z.ZodType> = z.output<T>;
const uuid = new ParseUUIDPipe();

/** Public: a property's published reviews. */
@Public()
@Controller('properties')
export class PublicReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get(':slug/reviews')
  async list(
    @Param('slug') slug: string,
    @Query(validate(propertyReviewsQuerySchema)) query: Out<typeof propertyReviewsQuerySchema>,
  ) {
    return ok(await this.reviews.forProperty(slug.slice(0, 160), query.page, query.pageSize));
  }
}

/** The customer reviews their own completed stay. */
@Controller('bookings')
@AccountTypes(AccountType.CUSTOMER)
@RequireVerifiedEmail()
export class CustomerReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post(':id/review')
  @RateLimit({ name: 'review:user', limit: 20, windowSeconds: 3600, by: 'user' })
  async create(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(createReviewSchema)) body: Out<typeof createReviewSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.reviews.create(auth.user.id, id, body, requestMeta(req)));
  }
}

@Controller('admin/reviews')
@AccountTypes(AccountType.ADMIN)
@RequireVerifiedEmail()
@RequirePermissions('reviews.moderate')
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  async list(
    @Query(validate(adminReviewListQuerySchema)) query: Out<typeof adminReviewListQuerySchema>,
  ) {
    return ok(await this.reviews.adminList(query));
  }

  @Post(':id/hide')
  @HttpCode(HttpStatus.OK)
  async hide(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(hideReviewSchema)) body: Out<typeof hideReviewSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.reviews.setHidden(auth.user.id, id, body, requestMeta(req)));
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  async restore(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Req() req: Request,
  ) {
    return ok(await this.reviews.setHidden(auth.user.id, id, null, requestMeta(req)));
  }
}

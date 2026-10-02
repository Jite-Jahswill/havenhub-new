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
import { AccountType, adminListBookingsQuerySchema, cancelBookingSchema } from '@havenhub/shared';
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
import { BookingQueriesService } from './booking-queries.service';
import { BookingsService } from './bookings.service';

const uuid = new ParseUUIDPipe();

@Controller('admin/bookings')
@AccountTypes(AccountType.ADMIN)
@RequireVerifiedEmail()
export class AdminBookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly queries: BookingQueriesService,
  ) {}

  @Get()
  @RequirePermissions('bookings.view')
  async list(
    @Query(validate(adminListBookingsQuerySchema))
    query: z.output<typeof adminListBookingsQuerySchema>,
  ) {
    return ok(await this.queries.adminList(query));
  }

  @Get(':id')
  @RequirePermissions('bookings.view')
  async get(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string) {
    return ok(await this.queries.adminDetail(id, auth.permissions));
  }

  /** Cancels with a full refund request (also after the stay has started). Audited. */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('bookings.view', 'payments.refund')
  async cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(cancelBookingSchema)) body: z.output<typeof cancelBookingSchema>,
    @Req() req: Request,
  ) {
    await this.bookings.cancel(
      { kind: 'ADMIN', userId: auth.user.id },
      id,
      body.reason,
      requestMeta(req),
    );
    return ok(await this.queries.adminDetail(id, auth.permissions));
  }
}

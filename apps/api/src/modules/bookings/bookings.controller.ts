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
  availabilityQuerySchema,
  bookingRequestSchema,
  cancelBookingSchema,
  createBookingSchema,
  listBookingsQuerySchema,
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
  RequireVerifiedEmail,
  SkipCsrf,
} from '../auth/decorators/auth.decorators';
import { BookingQueriesService } from './booking-queries.service';
import { BookingsService } from './bookings.service';

const uuid = new ParseUUIDPipe();

/** Public: price quotes and calendars. Neither reveals anything about other customers. */
@Public()
@Controller()
export class BookingDiscoveryController {
  constructor(private readonly bookings: BookingsService) {}

  @Get('properties/:id/availability')
  @RateLimit({ name: 'availability:ip', limit: 120, windowSeconds: 60, by: 'ip' })
  async availability(
    @Param('id', uuid) id: string,
    @Query(validate(availabilityQuerySchema)) query: z.output<typeof availabilityQuerySchema>,
  ) {
    return ok(await this.bookings.availabilityFor(id, query));
  }

  /** Read-only calculation; no state changes, so no CSRF token is needed. */
  @Post('bookings/quote')
  @SkipCsrf()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'quote:ip', limit: 120, windowSeconds: 60, by: 'ip' })
  async quote(@Body(validate(bookingRequestSchema)) body: z.output<typeof bookingRequestSchema>) {
    return ok(await this.bookings.quote(body));
  }
}

/** The signed-in customer's own bookings. Ownership always comes from the session. */
@Controller('bookings')
@AccountTypes(AccountType.CUSTOMER)
@RequireVerifiedEmail()
export class CustomerBookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly queries: BookingQueriesService,
  ) {}

  @Post()
  @RateLimit({ name: 'booking-create:user', limit: 20, windowSeconds: 3600, by: 'user' })
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(createBookingSchema)) body: z.output<typeof createBookingSchema>,
    @Req() req: Request,
  ) {
    const id = await this.bookings.create(auth.user.id, body, requestMeta(req));
    return ok(await this.queries.customerDetail(auth.user.id, id));
  }

  @Get()
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query(validate(listBookingsQuerySchema)) query: z.output<typeof listBookingsQuerySchema>,
  ) {
    return ok(await this.queries.customerList(auth.user.id, query));
  }

  @Get(':id')
  async get(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string) {
    return ok(await this.queries.customerDetail(auth.user.id, id));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(cancelBookingSchema)) body: z.output<typeof cancelBookingSchema>,
    @Req() req: Request,
  ) {
    await this.bookings.cancel(
      { kind: 'CUSTOMER', userId: auth.user.id, customerId: auth.user.id },
      id,
      body.reason,
      requestMeta(req),
    );
    return ok(await this.queries.customerDetail(auth.user.id, id));
  }
}

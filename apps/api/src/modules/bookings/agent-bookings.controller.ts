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
import { AccountType, cancelBookingSchema, listBookingsQuerySchema } from '@havenhub/shared';
import type { Request } from 'express';
import type { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
import { requestMeta } from '../../common/http/request-meta';
import { ok } from '../../common/http/response';
import { validate } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AuthContext } from '../auth/auth.types';
import {
  AccountTypes,
  CurrentAuth,
  RequireVerifiedEmail,
} from '../auth/decorators/auth.decorators';
import { BookingQueriesService } from './booking-queries.service';
import { BookingsService } from './bookings.service';

const uuid = new ParseUUIDPipe();

/**
 * Bookings on the signed-in agent's own properties. Scoped by the agent
 * profile resolved from the session; other agents' bookings answer 404.
 */
@Controller('agents/me')
@AccountTypes(AccountType.AGENT)
@RequireVerifiedEmail()
export class AgentBookingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly queries: BookingQueriesService,
  ) {}

  @Get('bookings')
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query(validate(listBookingsQuerySchema)) query: z.output<typeof listBookingsQuerySchema>,
  ) {
    return ok(await this.queries.agentList(await this.agentId(auth), query));
  }

  @Get('bookings/:id')
  async get(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string) {
    return ok(await this.queries.agentDetail(await this.agentId(auth), id));
  }

  @Post('bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(cancelBookingSchema)) body: z.output<typeof cancelBookingSchema>,
    @Req() req: Request,
  ) {
    const agentProfileId = await this.agentId(auth);
    await this.bookings.cancel(
      { kind: 'AGENT', userId: auth.user.id, agentProfileId },
      id,
      body.reason,
      requestMeta(req),
    );
    return ok(await this.queries.agentDetail(agentProfileId, id));
  }

  @Get('earnings')
  async earnings(@CurrentAuth() auth: AuthContext) {
    return ok(await this.queries.agentEarnings(await this.agentId(auth)));
  }

  private async agentId(auth: AuthContext): Promise<string> {
    const agent = await this.prisma.agentProfile.findUnique({
      where: { userId: auth.user.id },
      select: { id: true },
    });
    if (!agent) throw Errors.notFound('Agent profile');
    return agent.id;
  }
}

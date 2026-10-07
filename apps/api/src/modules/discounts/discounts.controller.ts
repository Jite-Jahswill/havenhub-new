import {
  Body,
  Controller,
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
  createDiscountCodeSchema,
  createPromoCodeSchema,
  discountCodeListQuerySchema,
  updateDiscountCodeSchema,
  updatePromoCodeSchema,
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
  RequirePermissions,
  RequireVerifiedEmail,
} from '../auth/decorators/auth.decorators';
import { PropertyAccessService } from '../properties/property-access.service';
import { DiscountsService } from './discounts.service';

const uuid = new ParseUUIDPipe();

/** Discount codes for agent plans (`discounts.manage`). */
@Controller('admin/discount-codes')
@AccountTypes(AccountType.ADMIN)
@RequireVerifiedEmail()
@RequirePermissions('discounts.manage')
export class AdminDiscountsController {
  constructor(private readonly discounts: DiscountsService) {}

  @Get()
  async list(
    @Query(validate(discountCodeListQuerySchema))
    query: z.output<typeof discountCodeListQuerySchema>,
  ) {
    return ok(await this.discounts.list(query));
  }

  @Post()
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(createDiscountCodeSchema)) body: z.output<typeof createDiscountCodeSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.discounts.create(auth, body, requestMeta(req)));
  }

  @Get(':id')
  async get(@Param('id', uuid) id: string) {
    return ok(await this.discounts.get(id));
  }

  @Patch(':id')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(updateDiscountCodeSchema)) body: z.output<typeof updateDiscountCodeSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.discounts.update(auth, id, body, requestMeta(req)));
  }

  /** Puts the code in the eligible agents' notification inbox. */
  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'discount-send:user', limit: 20, windowSeconds: 3600, by: 'user' })
  async send(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string, @Req() req: Request) {
    return ok(await this.discounts.send(auth, id, requestMeta(req)));
  }
}

/**
 * An agent's own promo codes for their property bookings. The agent funds the
 * discount; customers enter the code when booking.
 */
@Controller('agents/me/promo-codes')
@AccountTypes(AccountType.AGENT)
@RequireVerifiedEmail()
export class AgentPromoCodesController {
  constructor(
    private readonly discounts: DiscountsService,
    private readonly agents: PropertyAccessService,
  ) {}

  private async viewer(auth: AuthContext) {
    const agent = await this.agents.agentFor(auth.user.id);
    return { agent, viewer: { kind: 'AGENT' as const, agentProfileId: agent.id } };
  }

  @Get()
  async list(
    @CurrentAuth() auth: AuthContext,
    @Query(validate(discountCodeListQuerySchema))
    query: z.output<typeof discountCodeListQuerySchema>,
  ) {
    const { viewer } = await this.viewer(auth);
    return ok(await this.discounts.list(query, viewer));
  }

  @Post()
  @RateLimit({ name: 'promo-code-create:user', limit: 30, windowSeconds: 3600, by: 'user' })
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(createPromoCodeSchema)) body: z.output<typeof createPromoCodeSchema>,
    @Req() req: Request,
  ) {
    const { agent } = await this.viewer(auth);
    this.agents.assertCanManage(agent);
    return ok(await this.discounts.createPromo(auth, agent.id, body, requestMeta(req)));
  }

  @Get(':id')
  async get(@CurrentAuth() auth: AuthContext, @Param('id', uuid) id: string) {
    const { viewer } = await this.viewer(auth);
    return ok(await this.discounts.get(id, viewer));
  }

  @Patch(':id')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(validate(updatePromoCodeSchema)) body: z.output<typeof updatePromoCodeSchema>,
    @Req() req: Request,
  ) {
    const { agent, viewer } = await this.viewer(auth);
    this.agents.assertCanManage(agent);
    return ok(await this.discounts.update(auth, id, body, requestMeta(req), viewer));
  }
}

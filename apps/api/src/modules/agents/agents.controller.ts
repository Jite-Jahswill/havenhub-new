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
  Put,
  Req,
} from '@nestjs/common';
import {
  AccountType,
  submitAgentIdentitySchema,
  updateAgentProfileSchema,
  upsertPayoutAccountSchema,
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
} from '../auth/decorators/auth.decorators';
import { AgentsService } from './agents.service';

/**
 * `/agents/me/*` endpoints are always scoped to the signed-in agent — there
 * is no id parameter an agent could change to reach another agent's data.
 */
@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get('me')
  @AccountTypes(AccountType.AGENT)
  async me(@CurrentAuth() auth: AuthContext) {
    return ok(await this.agents.getOwn(auth.user.id));
  }

  @Patch('me')
  @AccountTypes(AccountType.AGENT)
  async updateMe(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(updateAgentProfileSchema)) body: z.output<typeof updateAgentProfileSchema>,
  ) {
    return ok(await this.agents.updateOwn(auth.user.id, body));
  }

  @Put('me/identity')
  @AccountTypes(AccountType.AGENT)
  @RequireVerifiedEmail()
  @RateLimit({ name: 'agent-identity:user', limit: 10, windowSeconds: 3600, by: 'user' })
  async submitIdentity(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(submitAgentIdentitySchema)) body: z.output<typeof submitAgentIdentitySchema>,
    @Req() req: Request,
  ) {
    return ok(await this.agents.submitIdentity(auth.user.id, body, requestMeta(req)));
  }

  @Put('me/payout-account')
  @AccountTypes(AccountType.AGENT)
  @RequireVerifiedEmail()
  @RateLimit({ name: 'agent-payout:user', limit: 10, windowSeconds: 3600, by: 'user' })
  async upsertPayoutAccount(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(upsertPayoutAccountSchema)) body: z.output<typeof upsertPayoutAccountSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.agents.upsertPayoutAccount(auth.user.id, body, requestMeta(req)));
  }

  @Post('me/verification')
  @HttpCode(HttpStatus.OK)
  @AccountTypes(AccountType.AGENT)
  @RequireVerifiedEmail()
  async submitForVerification(@CurrentAuth() auth: AuthContext, @Req() req: Request) {
    return ok(await this.agents.submitForVerification(auth.user.id, requestMeta(req)));
  }

  @Get('me/onboarding')
  @AccountTypes(AccountType.AGENT)
  async onboarding(@CurrentAuth() auth: AuthContext) {
    return ok(await this.agents.onboarding(auth.user.id));
  }

  @Post('me/onboarding/dismiss')
  @HttpCode(HttpStatus.OK)
  @AccountTypes(AccountType.AGENT)
  async dismissOnboarding(@CurrentAuth() auth: AuthContext) {
    return ok(await this.agents.setOnboardingDismissed(auth.user.id, true));
  }

  @Post('me/onboarding/restore')
  @HttpCode(HttpStatus.OK)
  @AccountTypes(AccountType.AGENT)
  async restoreOnboarding(@CurrentAuth() auth: AuthContext) {
    return ok(await this.agents.setOnboardingDismissed(auth.user.id, false));
  }

  @Get('me/plan')
  @AccountTypes(AccountType.AGENT)
  async plan(@CurrentAuth() auth: AuthContext) {
    return ok(await this.agents.planUsage(auth.user.id));
  }

  /** Public profile of a verified agent. Contains no contact or identity data. */
  @Public()
  @Get(':id')
  async publicProfile(@Param('id', new ParseUUIDPipe()) id: string) {
    return ok(await this.agents.getPublic(id));
  }
}

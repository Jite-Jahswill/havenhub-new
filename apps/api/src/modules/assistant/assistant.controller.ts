import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req } from '@nestjs/common';
import {
  AccountType,
  assistantAskSchema,
  assistantHandoffSchema,
  assistantQuestionsQuerySchema,
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
  OptionalAuth,
  Public,
  RequirePermissions,
  RequireVerifiedEmail,
  SkipCsrf,
} from '../auth/decorators/auth.decorators';
import { AssistantService } from './assistant.service';

/** The "Ask HavenHub" assistant: open to everyone; personal answers need sign-in. */
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  /** Read-only (it answers, it never changes anything), so like quotes it skips CSRF. */
  @Public()
  @SkipCsrf()
  @Post('ask')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'assistant:ip', limit: 30, windowSeconds: 60, by: 'ip' })
  async ask(
    @Body(validate(assistantAskSchema)) body: z.output<typeof assistantAskSchema>,
    @OptionalAuth() viewer: AuthContext | undefined,
  ) {
    return ok(await this.assistant.ask(body.text, viewer));
  }

  /** "Talk to a person": into the visitor's support conversation. */
  @Post('handoff')
  @HttpCode(HttpStatus.OK)
  @AccountTypes(AccountType.CUSTOMER, AccountType.AGENT)
  @RequireVerifiedEmail()
  @RateLimit({ name: 'assistant-handoff:user', limit: 10, windowSeconds: 3600, by: 'user' })
  async handoff(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(assistantHandoffSchema)) body: z.output<typeof assistantHandoffSchema>,
    @Req() req: Request,
  ) {
    return ok(await this.assistant.handoff(auth, body, requestMeta(req)));
  }
}

/** Support staff review what the assistant is asked, and what it could not answer. */
@Controller('admin/assistant')
@AccountTypes(AccountType.ADMIN)
@RequireVerifiedEmail()
@RequirePermissions('support.respond')
export class AdminAssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('stats')
  async stats() {
    return ok(await this.assistant.stats());
  }

  @Get('questions')
  async questions(
    @Query(validate(assistantQuestionsQuerySchema))
    query: z.output<typeof assistantQuestionsQuerySchema>,
  ) {
    return ok(await this.assistant.questions(query));
  }
}

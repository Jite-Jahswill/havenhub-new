import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { RealtimeTicketView } from '@havenhub/shared';

import { ok } from '../../common/http/response';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../auth/decorators/auth.decorators';
import { RealtimeTicketsService, TICKET_TTL_SECONDS } from './realtime-tickets.service';

@Controller('realtime')
export class RealtimeController {
  constructor(private readonly tickets: RealtimeTicketsService) {}

  /** A single-use ticket for opening the real-time connection (web clients). */
  @Post('ticket')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'realtime-ticket:user', limit: 60, windowSeconds: 600, by: 'user' })
  async ticket(@CurrentAuth() auth: AuthContext) {
    const ticket = await this.tickets.issue(auth.user.id, auth.sessionId);
    const view: RealtimeTicketView = { ticket, expiresInSeconds: TICKET_TTL_SECONDS };
    return ok(view);
  }
}

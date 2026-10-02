import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { RedisService } from '../../infrastructure/redis/redis.service';

export const TICKET_TTL_SECONDS = 60;
const key = (ticket: string) => `rt:ticket:${createHash('sha256').update(ticket).digest('hex')}`;

/**
 * One-time tickets for opening a real-time connection from the browser. The
 * web app's session lives in HttpOnly cookies on its own origin, which a
 * socket to the API origin cannot read; the browser asks the API (with its
 * cookies) for a ticket and presents it in the socket handshake. Tickets
 * are single-use (GETDEL), expire in a minute and are stored hashed.
 */
@Injectable()
export class RealtimeTicketsService {
  constructor(private readonly redis: RedisService) {}

  async issue(userId: string, sessionId: string): Promise<string> {
    const ticket = randomBytes(32).toString('base64url');
    await this.redis.client.set(
      key(ticket),
      JSON.stringify({ userId, sessionId }),
      'EX',
      TICKET_TTL_SECONDS,
    );
    return ticket;
  }

  async redeem(ticket: string): Promise<{ userId: string; sessionId: string } | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) return null;
    const raw = await this.redis.client.getdel(key(ticket));
    return raw ? (JSON.parse(raw) as { userId: string; sessionId: string }) : null;
  }
}

import { Injectable } from '@nestjs/common';
import type { UnreadSummary } from '@havenhub/shared';

import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Unread = messages from others with seq above the reader's cursor that are
 * not deleted. One indexed query (messages(conversation_id, seq)) per call,
 * whatever the number of conversations — no per-message receipt rows.
 */
@Injectable()
export class UnreadService {
  constructor(private readonly prisma: PrismaService) {}

  async forConversations(userId: string, conversationIds: string[]): Promise<Map<string, number>> {
    if (conversationIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<{ conversation_id: string; unread: bigint }[]>`
      SELECT m.conversation_id, count(*) AS unread
      FROM messages m
      JOIN conversation_participants p
        ON p.conversation_id = m.conversation_id AND p.user_id = ${userId}::uuid
      WHERE m.conversation_id IN (${Prisma.join(conversationIds.map((id) => Prisma.sql`${id}::uuid`))})
        AND m.seq > p.last_read_seq
        AND m.sender_id IS DISTINCT FROM ${userId}::uuid
        AND m.deleted_at IS NULL
      GROUP BY m.conversation_id`;
    return new Map(rows.map((r) => [r.conversation_id, Number(r.unread)]));
  }

  async summary(userId: string): Promise<UnreadSummary> {
    const [row] = await this.prisma.$queryRaw<{ conversations: bigint; messages: bigint }[]>`
      SELECT count(DISTINCT m.conversation_id) AS conversations, count(*) AS messages
      FROM conversation_participants p
      JOIN messages m ON m.conversation_id = p.conversation_id AND m.seq > p.last_read_seq
      WHERE p.user_id = ${userId}::uuid
        AND p.archived_at IS NULL
        AND m.sender_id IS DISTINCT FROM ${userId}::uuid
        AND m.deleted_at IS NULL`;
    return { conversations: Number(row?.conversations ?? 0), messages: Number(row?.messages ?? 0) };
  }
}

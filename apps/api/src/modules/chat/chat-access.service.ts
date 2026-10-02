import { Injectable } from '@nestjs/common';

import { Errors } from '../../common/errors/app.exception';
import type { ConversationParticipant, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

/**
 * Every chat read or write starts here. A conversation the caller is not a
 * participant of is reported as "not found" — never "forbidden" — so ids
 * cannot be probed for existence.
 */
@Injectable()
export class ChatAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async participant(
    conversationId: string,
    userId: string,
    db: Db = this.prisma,
  ): Promise<ConversationParticipant> {
    const participant = await db.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!participant) throw Errors.notFound('Conversation');
    return participant;
  }

  async participantIds(conversationId: string, db: Db = this.prisma): Promise<string[]> {
    const rows = await db.conversationParticipant.findMany({
      where: { conversationId },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }
}

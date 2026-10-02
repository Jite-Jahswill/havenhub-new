import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ChatClientEvent, ChatEvent } from '@havenhub/shared';
import type { Socket } from 'socket.io';

import { RealtimeGateway, type SocketIdentity } from '../realtime/realtime.gateway';
import { ChatAccessService } from './chat-access.service';
import { ChatEventsService } from './chat-events.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TYPING_THROTTLE_MS = 2_000;
const MEMBERSHIP_TTL_MS = 60_000;

/**
 * Typing indicators: client → server → the other participants. Never
 * persisted. The sender must participate in the conversation (checked, then
 * cached briefly per socket) and is throttled per conversation. Clients
 * expire an indicator on their own if no "stopped" arrives (~6 s).
 */
@Injectable()
export class ChatRealtimeHandlers implements OnModuleInit {
  constructor(
    private readonly realtime: RealtimeGateway,
    private readonly access: ChatAccessService,
    private readonly events: ChatEventsService,
  ) {}

  onModuleInit(): void {
    this.realtime.onClientEvent(ChatClientEvent.TYPING_START, (id, payload, socket) =>
      this.typing(ChatEvent.TYPING_STARTED, id, payload, socket),
    );
    this.realtime.onClientEvent(ChatClientEvent.TYPING_STOP, (id, payload, socket) =>
      this.typing(ChatEvent.TYPING_STOPPED, id, payload, socket),
    );
  }

  private async typing(
    event: typeof ChatEvent.TYPING_STARTED | typeof ChatEvent.TYPING_STOPPED,
    identity: SocketIdentity,
    payload: unknown,
    socket: Socket,
  ): Promise<void> {
    const conversationId = (payload as { conversationId?: unknown } | null)?.conversationId;
    if (typeof conversationId !== 'string' || !UUID.test(conversationId)) return;

    const data = socket.data as { chat?: SocketChatState };
    data.chat ??= { lastTyping: new Map(), members: new Map() };
    const state: SocketChatState = data.chat;
    if (event === ChatEvent.TYPING_STARTED) {
      const last = state.lastTyping.get(conversationId) ?? 0;
      if (Date.now() - last < TYPING_THROTTLE_MS) return;
      state.lastTyping.set(conversationId, Date.now());
    } else {
      state.lastTyping.delete(conversationId);
    }

    let members = state.members.get(conversationId);
    if (!members || members.until < Date.now()) {
      const ids = await this.access.participantIds(conversationId);
      members = { ids, until: Date.now() + MEMBERSHIP_TTL_MS };
      state.members.set(conversationId, members);
    }
    if (!members.ids.includes(identity.userId)) return; // not a participant: ignore silently
    this.events.typing(event, conversationId, identity.userId, members.ids);
  }
}

interface SocketChatState {
  lastTyping: Map<string, number>;
  members: Map<string, { ids: string[]; until: number }>;
}

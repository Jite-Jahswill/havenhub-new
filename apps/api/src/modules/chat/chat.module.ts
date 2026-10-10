import { Module } from '@nestjs/common';

import { AdminChatController } from './admin-chat.controller';
import { AttachmentsService } from './attachments.service';
import { ChatAccessService } from './chat-access.service';
import { ChatAdminService } from './chat-admin.service';
import { ChatController } from './chat.controller';
import { ChatEventsService } from './chat-events.service';
import { ChatMaintenanceService } from './chat-maintenance.service';
import { ChatNotificationsService } from './chat-notifications.service';
import { ChatRealtimeHandlers } from './chat-realtime.handlers';
import { ConversationsService } from './conversations.service';
import { MessagesService } from './messages.service';
import { AdminSupportController } from './support.controller';
import { SupportService } from './support.service';
import { UnreadService } from './unread.service';

/**
 * Communication (Phase 5): conversations about a property, booking,
 * experience or (Phase 7) a support request,
 * messages, attachments, reactions, read cursors, real-time delivery
 * (via the global RealtimeModule) and digest notifications.
 */
@Module({
  controllers: [ChatController, AdminChatController, AdminSupportController],
  providers: [
    ChatAccessService,
    ConversationsService,
    MessagesService,
    AttachmentsService,
    UnreadService,
    ChatEventsService,
    ChatNotificationsService,
    ChatRealtimeHandlers,
    ChatMaintenanceService,
    ChatAdminService,
    SupportService,
  ],
  exports: [ConversationsService, ChatMaintenanceService, MessagesService, ChatEventsService],
})
export class ChatModule {}

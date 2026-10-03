import type { BookingStatus } from '../enums/booking.js';
import type { ExperienceKind } from '../enums/experience.js';
import type {
  AttachmentKind,
  ConversationStatus,
  MessageType,
  ParticipantRole,
} from '../enums/chat.js';

/**
 * Communication API shapes (Phase 5), shared by the web app and the future
 * mobile app. Message text is plain text: render it as text, never as HTML.
 */

export interface ChatUserView {
  id: string;
  name: string;
  avatarUrl: string | null;
  role: ParticipantRole;
}

export interface ChatParticipantView extends ChatUserView {
  /** Every message with seq <= lastReadSeq has been read by this participant. */
  lastReadSeq: number;
}

export type ConversationContextView =
  | {
      type: 'PROPERTY';
      property: { id: string; slug: string; title: string; thumbnailUrl: string | null };
    }
  | {
      type: 'EXPERIENCE';
      experience: {
        id: string;
        slug: string;
        kind: ExperienceKind;
        title: string;
        thumbnailUrl: string | null;
      };
    }
  | { type: 'SUPPORT' }
  | {
      type: 'BOOKING';
      booking: {
        id: string;
        reference: string;
        status: BookingStatus;
        propertyTitle: string;
        startDate: string;
        endDate: string;
      };
    };

/** A short, safe preview: deleted content is never included. */
export interface MessagePreview {
  id: string;
  seq: number;
  type: MessageType;
  senderId: string | null;
  text: string | null;
  deleted: boolean;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  status: ConversationStatus;
  context: ConversationContextView;
  participants: ChatParticipantView[];
  /** Highest message seq in the conversation. */
  lastSeq: number;
  lastMessage: MessagePreview | null;
  lastActivityAt: string;
  /** Messages from others after your read cursor (deleted ones excluded). */
  unreadCount: number;
  myLastReadSeq: number;
  archived: boolean;
  createdAt: string;
}

export interface ConversationPage {
  items: ConversationSummary[];
  /** Pass as `cursor` for the next page; null when there are no more. */
  nextCursor: string | null;
}

export interface MessageAttachmentView {
  id: string;
  kind: AttachmentKind;
  fileName: string;
  contentType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  /** Authenticated API path; only conversation participants can load it. */
  url: string;
  thumbnailUrl: string | null;
}

/** Enough to render a quote of the original — never nested further. */
export interface ReplyPreview {
  id: string;
  seq: number;
  senderId: string | null;
  senderName: string | null;
  type: MessageType;
  /** Up to 160 characters; null if deleted or attachment-only. */
  text: string | null;
  attachmentKind: AttachmentKind | null;
  deleted: boolean;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  /** Whether the viewer is one of the reactors. */
  mine: boolean;
}

export interface MessageView {
  id: string;
  conversationId: string;
  seq: number;
  type: MessageType;
  sender: ChatUserView | null;
  /** Null when deleted (content is never sent once deleted). */
  body: string | null;
  attachments: MessageAttachmentView[];
  replyTo: ReplyPreview | null;
  reactions: ReactionSummary[];
  /** Your own idempotency key, so optimistic messages can be reconciled. Null for others'. */
  clientKey: string | null;
  /** Present for SYSTEM messages only. */
  metadata: Record<string, string> | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  /** Whether the viewer may still edit it (own, not deleted, within the edit window). */
  canEdit: boolean;
  canDelete: boolean;
}

export interface MessagePage {
  /** Ascending by seq. */
  items: MessageView[];
  /** More messages exist beyond this page in the requested direction. */
  hasMore: boolean;
  /** The conversation's highest seq when the page was read. */
  lastSeq: number;
}

export interface UnreadSummary {
  /** Conversations with at least one unread message. */
  conversations: number;
  messages: number;
}

export interface RealtimeTicketView {
  /** Single-use, short-lived; pass as `auth.ticket` when connecting the socket. */
  ticket: string;
  expiresInSeconds: number;
}

// ── Admin (moderation) ───────────────────────────────────────────────────────

export interface AdminConversationListItem {
  id: string;
  status: ConversationStatus;
  context: ConversationContextView;
  participants: (ChatUserView & { email: string })[];
  messageCount: number;
  lastActivityAt: string;
  createdAt: string;
}

export interface AdminMessageView extends MessageView {
  /** Moderators can see what was removed or edited, for review. */
  originalBody: string | null;
  revisions: { body: string | null; createdAt: string }[];
  deletedBy: { id: string; name: string } | null;
}

export interface AdminConversationDetail extends AdminConversationListItem {
  closedAt: string | null;
  closedReason: string | null;
  messages: AdminMessageView[];
  hasMore: boolean;
}

// ── Real-time event payloads ─────────────────────────────────────────────────

interface EventBase {
  /** Unique per event; clients drop repeats. */
  eventId: string;
  conversationId: string;
}

export type ChatEventPayloads = {
  'conversation.created': EventBase & { conversation: ConversationSummary };
  'conversation.updated': EventBase & { conversation: ConversationSummary };
  'message.created': EventBase & { message: MessageView };
  'message.updated': EventBase & { message: MessageView };
  'message.deleted': EventBase & { message: MessageView };
  'message.reaction.updated': EventBase & {
    messageId: string;
    reactions: ReactionSummary[];
  };
  'message.read': EventBase & { userId: string; lastReadSeq: number };
  'typing.started': EventBase & { userId: string };
  'typing.stopped': EventBase & { userId: string };
};

/** Phase 7: the support queue (admins with `support.respond`). */
export interface SupportConversationItem {
  id: string;
  status: ConversationStatus;
  requester: { id: string; name: string; email: string; role: ParticipantRole } | null;
  /** Support staff who have joined. */
  staff: { id: string; name: string }[];
  /** Whether the viewer has joined (and can therefore read and reply). */
  joined: boolean;
  lastActivityAt: string;
  createdAt: string;
}

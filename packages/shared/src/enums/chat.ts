/**
 * Communication (Phase 5). A conversation is about one business context and
 * has participants; messages are ordered by a per-conversation `seq`.
 */
export const ConversationContextType = {
  PROPERTY: 'PROPERTY',
  BOOKING: 'BOOKING',
  /** Phase 6: an event, tour, hotel or cleaning-service listing. */
  EXPERIENCE: 'EXPERIENCE',
} as const;
export type ConversationContextType =
  (typeof ConversationContextType)[keyof typeof ConversationContextType];

export const ConversationStatus = {
  OPEN: 'OPEN',
  /** Closed by a moderator: readable, no new messages. */
  CLOSED: 'CLOSED',
} as const;
export type ConversationStatus = (typeof ConversationStatus)[keyof typeof ConversationStatus];

export const ParticipantRole = {
  CUSTOMER: 'CUSTOMER',
  AGENT: 'AGENT',
  ADMIN: 'ADMIN',
  SYSTEM: 'SYSTEM',
} as const;
export type ParticipantRole = (typeof ParticipantRole)[keyof typeof ParticipantRole];

export const MessageType = {
  TEXT: 'TEXT',
  IMAGE: 'IMAGE',
  VIDEO: 'VIDEO',
  AUDIO: 'AUDIO',
  FILE: 'FILE',
  SYSTEM: 'SYSTEM',
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export const AttachmentKind = {
  IMAGE: 'IMAGE',
  VIDEO: 'VIDEO',
  AUDIO: 'AUDIO',
  FILE: 'FILE',
} as const;
export type AttachmentKind = (typeof AttachmentKind)[keyof typeof AttachmentKind];

/** The reactions HavenHub offers. Stored as the emoji itself, so new ones can be added. */
export const MESSAGE_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;
export type MessageReactionEmoji = (typeof MESSAGE_REACTIONS)[number];

export const REACTION_LABELS: Record<MessageReactionEmoji, string> = {
  '👍': 'Thumbs up',
  '❤️': 'Love',
  '😂': 'Laugh',
  '😮': 'Surprised',
  '😢': 'Sad',
  '🙏': 'Thanks',
};

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_ATTACHMENTS_PER_MESSAGE = 6;
/** How long after sending a message its author may still edit it. */
export const MESSAGE_EDIT_WINDOW_MINUTES = 15;

/** Upload limits per attachment kind, in bytes. Enforced by the API. */
export const ATTACHMENT_LIMITS: Record<AttachmentKind, { maxBytes: number; label: string }> = {
  IMAGE: { maxBytes: 10 * 1024 * 1024, label: 'JPEG, PNG, WebP or HEIC up to 10 MB' },
  VIDEO: { maxBytes: 50 * 1024 * 1024, label: 'MP4, MOV or WebM up to 50 MB' },
  AUDIO: { maxBytes: 15 * 1024 * 1024, label: 'MP3, M4A, OGG, WAV or WebM up to 15 MB' },
  FILE: {
    maxBytes: 20 * 1024 * 1024,
    label: 'PDF, Word, Excel, PowerPoint, TXT or CSV up to 20 MB',
  },
};
export const MAX_ATTACHMENT_BYTES = Math.max(
  ...Object.values(ATTACHMENT_LIMITS).map((l) => l.maxBytes),
);

/**
 * Real-time event names (Socket.IO). Every payload carries `eventId` so a
 * client can drop duplicates; the REST API stays the source of truth.
 */
export const ChatEvent = {
  CONVERSATION_CREATED: 'conversation.created',
  CONVERSATION_UPDATED: 'conversation.updated',
  MESSAGE_CREATED: 'message.created',
  MESSAGE_UPDATED: 'message.updated',
  MESSAGE_DELETED: 'message.deleted',
  MESSAGE_REACTION_UPDATED: 'message.reaction.updated',
  MESSAGE_READ: 'message.read',
  TYPING_STARTED: 'typing.started',
  TYPING_STOPPED: 'typing.stopped',
} as const;
export type ChatEvent = (typeof ChatEvent)[keyof typeof ChatEvent];

/** Events a client sends to the server over the socket. */
export const ChatClientEvent = {
  TYPING_START: 'typing.start',
  TYPING_STOP: 'typing.stop',
} as const;

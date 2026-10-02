import {
  MESSAGE_EDIT_WINDOW_MINUTES,
  MESSAGE_REACTIONS,
  type AttachmentKind,
  type ChatUserView,
  type ConversationContextView,
  type ConversationSummary,
  type MessageAttachmentView,
  type MessagePreview,
  type MessageView,
  type ParticipantRole,
  type ReactionSummary,
  type ReplyPreview,
} from '@havenhub/shared';

import type { Prisma } from '../../generated/prisma/client';
import type { StorageService } from '../../infrastructure/storage/storage.service';

type Urls = Pick<StorageService, 'url'>;

export const CHAT_USER_SELECT = {
  id: true,
  fullName: true,
  avatarKey: true,
  accountType: true,
  agentProfile: { select: { businessName: true } },
} as const;

export const MESSAGE_INCLUDE = {
  sender: { select: CHAT_USER_SELECT },
  attachments: { orderBy: { createdAt: 'asc' } },
  reactions: { select: { emoji: true, userId: true } },
  replyTo: {
    select: {
      id: true,
      seq: true,
      senderId: true,
      type: true,
      body: true,
      deletedAt: true,
      sender: { select: CHAT_USER_SELECT },
      attachments: { take: 1, orderBy: { createdAt: 'asc' }, select: { kind: true } },
    },
  },
} as const satisfies Prisma.MessageInclude;

export type MessageRow = Prisma.MessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>;

export const CONVERSATION_INCLUDE = {
  participants: { include: { user: { select: CHAT_USER_SELECT } }, orderBy: { joinedAt: 'asc' } },
  property: {
    select: {
      id: true,
      slug: true,
      title: true,
      images: { where: { isPrimary: true }, take: 1, select: { thumbnailKey: true } },
    },
  },
  experience: {
    select: {
      id: true,
      slug: true,
      kind: true,
      title: true,
      images: { where: { isPrimary: true }, take: 1, select: { thumbnailKey: true } },
    },
  },
  booking: {
    select: {
      id: true,
      reference: true,
      status: true,
      startDate: true,
      endDate: true,
      property: { select: { title: true } },
    },
  },
  lastMessage: {
    select: {
      id: true,
      seq: true,
      type: true,
      senderId: true,
      body: true,
      deletedAt: true,
      createdAt: true,
      attachments: { take: 1, orderBy: { createdAt: 'asc' }, select: { kind: true } },
    },
  },
} as const satisfies Prisma.ConversationInclude;

export type ConversationRow = Prisma.ConversationGetPayload<{
  include: typeof CONVERSATION_INCLUDE;
}>;

type ChatUserRow = Prisma.UserGetPayload<{ select: typeof CHAT_USER_SELECT }>;

/** Agents appear under their business name; everyone else by their name. */
export const chatDisplayName = (u: Pick<ChatUserRow, 'fullName' | 'agentProfile'>) =>
  u.agentProfile?.businessName ?? u.fullName;

const roleOf = (u: Pick<ChatUserRow, 'accountType'>): ParticipantRole =>
  u.accountType === 'AGENT' ? 'AGENT' : u.accountType === 'ADMIN' ? 'ADMIN' : 'CUSTOMER';

export const toChatUser = (u: ChatUserRow, urls: Urls, role = roleOf(u)): ChatUserView => ({
  id: u.id,
  name: chatDisplayName(u),
  avatarUrl: urls.url(u.avatarKey),
  role,
});

const KIND_LABEL: Record<AttachmentKind, string> = {
  IMAGE: 'Photo',
  VIDEO: 'Video',
  AUDIO: 'Audio',
  FILE: 'File',
};

const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

export function toContext(row: ConversationRow, urls: Urls): ConversationContextView {
  if (row.contextType === 'BOOKING' && row.booking) {
    return {
      type: 'BOOKING',
      booking: {
        id: row.booking.id,
        reference: row.booking.reference,
        status: row.booking.status,
        propertyTitle: row.booking.property.title,
        startDate: row.booking.startDate.toISOString().slice(0, 10),
        endDate: row.booking.endDate.toISOString().slice(0, 10),
      },
    };
  }
  if (row.contextType === 'EXPERIENCE' && row.experience) {
    const e = row.experience;
    return {
      type: 'EXPERIENCE',
      experience: {
        id: e.id,
        slug: e.slug,
        kind: e.kind,
        title: e.title,
        thumbnailUrl: urls.url(e.images[0]?.thumbnailKey),
      },
    };
  }
  const p = row.property!;
  return {
    type: 'PROPERTY',
    property: {
      id: p.id,
      slug: p.slug,
      title: p.title,
      thumbnailUrl: urls.url(p.images[0]?.thumbnailKey),
    },
  };
}

export function toPreview(m: ConversationRow['lastMessage']): MessagePreview | null {
  if (!m) return null;
  const deleted = m.deletedAt !== null;
  const kind = m.attachments[0]?.kind;
  return {
    id: m.id,
    seq: m.seq,
    type: m.type,
    senderId: m.senderId,
    text: deleted ? null : m.body ? truncate(m.body, 120) : kind ? KIND_LABEL[kind] : null,
    deleted,
    createdAt: m.createdAt.toISOString(),
  };
}

export function toConversationSummary(
  row: ConversationRow,
  viewerId: string,
  unreadCount: number,
  urls: Urls,
): ConversationSummary {
  const me = row.participants.find((p) => p.userId === viewerId);
  return {
    id: row.id,
    status: row.status,
    context: toContext(row, urls),
    participants: row.participants.map((p) => ({
      ...toChatUser(p.user, urls, p.role),
      lastReadSeq: p.lastReadSeq,
    })),
    lastSeq: row.lastSeq,
    lastMessage: toPreview(row.lastMessage),
    lastActivityAt: row.lastActivityAt.toISOString(),
    unreadCount,
    myLastReadSeq: me?.lastReadSeq ?? 0,
    archived: Boolean(me?.archivedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

export const attachmentUrl = (conversationId: string, attachmentId: string, thumbnail = false) =>
  `/api/v1/conversations/${conversationId}/attachments/${attachmentId}${thumbnail ? '?variant=thumbnail' : ''}`;

function toAttachment(a: MessageRow['attachments'][number]): MessageAttachmentView {
  return {
    id: a.id,
    kind: a.kind,
    fileName: a.fileName,
    contentType: a.contentType,
    bytes: a.bytes,
    width: a.width,
    height: a.height,
    url: attachmentUrl(a.conversationId, a.id),
    thumbnailUrl: a.thumbnailKey ? attachmentUrl(a.conversationId, a.id, true) : null,
  };
}

function toReply(r: NonNullable<MessageRow['replyTo']>): ReplyPreview {
  const deleted = r.deletedAt !== null;
  return {
    id: r.id,
    seq: r.seq,
    senderId: r.senderId,
    senderName: r.sender ? chatDisplayName(r.sender) : null,
    type: r.type,
    text: deleted || !r.body ? null : truncate(r.body, 160),
    attachmentKind: deleted ? null : (r.attachments[0]?.kind ?? null),
    deleted,
  };
}

export function toReactions(
  rows: { emoji: string; userId: string }[],
  viewerId: string,
): ReactionSummary[] {
  const counts = new Map<string, ReactionSummary>();
  for (const r of rows) {
    const entry = counts.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
    entry.count++;
    if (r.userId === viewerId) entry.mine = true;
    counts.set(r.emoji, entry);
  }
  const order = MESSAGE_REACTIONS as readonly string[];
  return [...counts.values()].sort((a, b) => order.indexOf(a.emoji) - order.indexOf(b.emoji));
}

/**
 * The viewer-specific view of a message. Deleted messages keep their place
 * in the history but carry no content, attachments, reply or reactions.
 */
export function toMessageView(
  m: MessageRow,
  viewerId: string,
  urls: Urls,
  now = new Date(),
): MessageView {
  const deleted = m.deletedAt !== null;
  const own = m.senderId === viewerId;
  const editable =
    own &&
    !deleted &&
    m.type !== 'SYSTEM' &&
    m.body !== null &&
    now.getTime() - m.createdAt.getTime() < MESSAGE_EDIT_WINDOW_MINUTES * 60_000;
  return {
    id: m.id,
    conversationId: m.conversationId,
    seq: m.seq,
    type: m.type,
    sender: m.sender ? toChatUser(m.sender, urls) : null,
    body: deleted ? null : m.body,
    attachments: deleted ? [] : m.attachments.map(toAttachment),
    replyTo: deleted || !m.replyTo ? null : toReply(m.replyTo),
    reactions: deleted ? [] : toReactions(m.reactions, viewerId),
    clientKey: own ? m.clientKey : null,
    metadata: m.type === 'SYSTEM' ? ((m.metadata as Record<string, string> | null) ?? null) : null,
    editedAt: m.editedAt?.toISOString() ?? null,
    deletedAt: m.deletedAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
    canEdit: editable,
    canDelete: own && !deleted && m.type !== 'SYSTEM',
  };
}

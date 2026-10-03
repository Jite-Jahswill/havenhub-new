import { z } from 'zod';

import {
  ConversationStatus,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_MESSAGE_LENGTH,
  MESSAGE_REACTIONS,
} from '../enums/chat.js';
import { paginationQuerySchema } from './admin.js';

/**
 * Message text is plain text, always. Control characters (other than line
 * breaks and tabs) are removed, line endings normalised and the result
 * trimmed. Clients must render it as text — never as HTML.
 */
const CONTROL_CHARS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;
export const normalizeMessageText = (value: string) =>
  value.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').trim();

const messageText = z
  .string()
  .transform(normalizeMessageText)
  .pipe(
    z.string().max(MAX_MESSAGE_LENGTH, `Messages can be up to ${MAX_MESSAGE_LENGTH} characters`),
  );

/** Starts (or returns the existing) conversation about a property, booking, experience or support. */
export const startConversationSchema = z.discriminatedUnion('contextType', [
  z.object({ contextType: z.literal('PROPERTY'), propertyId: z.uuid() }),
  z.object({ contextType: z.literal('BOOKING'), bookingId: z.uuid() }),
  z.object({ contextType: z.literal('EXPERIENCE'), experienceId: z.uuid() }),
  /** Phase 7: the signed-in customer's or agent's conversation with HavenHub support. */
  z.object({ contextType: z.literal('SUPPORT') }),
]);
export type StartConversationInput = z.input<typeof startConversationSchema>;

export const listConversationsQuerySchema = z.object({
  archived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  search: z.string().trim().max(80).optional(),
  /** Opaque cursor from the previous page's `nextCursor`. */
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * Message history by seq cursor: no cursor = newest page; `before` = older
 * than that seq; `after` = newer than that seq (catch-up after reconnect).
 */
export const listMessagesQuerySchema = z
  .object({
    before: z.coerce.number().int().min(1).optional(),
    after: z.coerce.number().int().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .refine((q) => q.before === undefined || q.after === undefined, {
    message: 'Use either before or after, not both',
  });

/** A client-generated id (e.g. a UUID) that makes sending safe to retry. */
export const clientKeyField = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,64}$/, 'clientKey must be 8–64 letters, digits, - or _');

export const sendMessageSchema = z
  .object({
    clientKey: clientKeyField,
    body: messageText.optional(),
    replyToId: z.uuid().optional(),
    attachmentIds: z.array(z.uuid()).max(MAX_ATTACHMENTS_PER_MESSAGE).default([]),
  })
  .refine((m) => Boolean(m.body) || m.attachmentIds.length > 0, {
    path: ['body'],
    message: 'Write a message or attach a file',
  })
  .refine((m) => new Set(m.attachmentIds).size === m.attachmentIds.length, {
    path: ['attachmentIds'],
    message: 'Each attachment can be sent once',
  });
export type SendMessageInput = z.input<typeof sendMessageSchema>;

export const editMessageSchema = z.object({
  body: messageText.pipe(z.string().min(1, 'A message cannot be empty')),
});

export const reactionSchema = z.object({
  emoji: z.enum(MESSAGE_REACTIONS),
});

/** Marks everything up to and including `seq` as read (clamped by the server). */
export const markConversationReadSchema = z.object({
  seq: z.number().int().min(0),
});

export const archiveConversationSchema = z.object({
  archived: z.boolean(),
});

export const adminListConversationsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  status: z.enum(ConversationStatus).optional(),
});

export const moderateMessageSchema = z.object({
  reason: z.string().trim().min(3, 'Give a reason').max(500),
});

export const setConversationStatusSchema = z.object({
  status: z.enum(ConversationStatus),
  reason: z.string().trim().min(3, 'Give a reason').max(500),
});

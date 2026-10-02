import type {
  ChatEventPayloads,
  ConversationSummary,
  MessageAttachmentView,
  MessagePage,
  MessageView,
} from '@havenhub/shared';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { RedisService } from '../src/infrastructure/redis/redis.service';
import { RealtimeGateway } from '../src/modules/realtime/realtime.gateway';
import { AttachmentsService } from '../src/modules/chat/attachments.service';
import { ChatNotificationsService } from '../src/modules/chat/chat-notifications.service';
import {
  adminAuth,
  book,
  customer,
  inDays,
  rental,
  setPricing,
  type Customer,
} from './helpers/booking-helpers';
import {
  createAgent,
  createPublished,
  createTestContext,
  loginToken,
  PASSWORD,
  testImage,
  type Agent,
  type TestContext,
} from './helpers/test-app';

let ctx: TestContext;
let other: TestContext;
const sockets: Socket[] = [];

beforeAll(async () => {
  ctx = await createTestContext();
  other = await createTestContext();
});
beforeEach(() => ctx.reset());
afterEach(() => {
  for (const s of sockets.splice(0)) s.disconnect();
});
afterAll(async () => {
  await other.close();
  await ctx.close();
});

type Who = Customer | Agent;
let keyCounter = 0;
const clientKey = () => `test-key-${Date.now()}-${++keyCounter}`;

async function scenario() {
  const agent = await createAgent(ctx);
  const property = await createPublished(ctx, agent);
  const c = await customer(ctx);
  const conversation = await start(c, property.id);
  return { agent, property, customer: c, conversation };
}

async function start(who: Who, propertyId: string, expected = 200) {
  const res = await ctx
    .http()
    .post('/api/v1/conversations')
    .set(who.auth)
    .send({ contextType: 'PROPERTY', propertyId });
  expect(res.status, JSON.stringify(res.body)).toBe(expected);
  return res.body.data as ConversationSummary;
}

async function send(
  who: Who,
  conversationId: string,
  body: Record<string, unknown> = { body: 'Hello there' },
  expected = 201,
) {
  const res = await ctx
    .http()
    .post(`/api/v1/conversations/${conversationId}/messages`)
    .set(who.auth)
    .send({ clientKey: clientKey(), ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(expected);
  return res.body.data as MessageView;
}

const page = async (who: Who, conversationId: string, query = '') =>
  (
    await ctx
      .http()
      .get(`/api/v1/conversations/${conversationId}/messages${query}`)
      .set(who.auth)
      .expect(200)
  ).body.data as MessagePage;

const summary = async (who: Who, conversationId: string) =>
  (await ctx.http().get(`/api/v1/conversations/${conversationId}`).set(who.auth).expect(200)).body
    .data as ConversationSummary;

async function upload(
  who: Who,
  conversationId: string,
  file: Buffer,
  name: string,
  expected = 201,
) {
  const res = await ctx
    .http()
    .post(`/api/v1/conversations/${conversationId}/attachments`)
    .set(who.auth)
    .attach('file', file, { filename: name, contentType: 'application/octet-stream' });
  expect(res.status, JSON.stringify(res.body)).toBe(expected);
  return res.body as { data: MessageAttachmentView; code?: string; message?: string };
}

const tokenOf = (who: Who) => who.auth.Authorization.slice('Bearer '.length);

async function ticket(who: Who) {
  return (await ctx.http().post('/api/v1/realtime/ticket').set(who.auth).expect(200)).body.data
    .ticket as string;
}

function socket(app: TestContext, auth: Record<string, string>): Promise<Socket> {
  const s = connect(app.baseUrl, {
    path: '/realtime',
    auth,
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  sockets.push(s);
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', (error) => reject(error));
  });
}

function next<E extends keyof ChatEventPayloads>(
  s: Socket,
  event: E,
  match: (p: ChatEventPayloads[E]) => boolean = () => true,
  timeout = 4000,
): Promise<ChatEventPayloads[E]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeout);
    const handler = (payload: ChatEventPayloads[E]) => {
      if (!match(payload)) return;
      clearTimeout(timer);
      s.off(event, handler as never);
      resolve(payload);
    };
    s.on(event, handler as never);
  });
}

const silence = (s: Socket, event: string, ms = 600) =>
  new Promise<number>((resolve) => {
    let count = 0;
    const handler = () => count++;
    s.on(event, handler);
    setTimeout(() => {
      s.off(event, handler);
      resolve(count);
    }, ms);
  });

describe('conversations', () => {
  it('a customer starts a conversation about a listing; starting again returns the same one', async () => {
    const { agent, property, customer: c, conversation } = await scenario();
    expect(conversation).toMatchObject({
      status: 'OPEN',
      context: { type: 'PROPERTY', property: { id: property.id } },
      unreadCount: 0,
      lastMessage: null,
    });
    expect(conversation.participants.map((p) => p.role).sort()).toEqual(['AGENT', 'CUSTOMER']);
    expect(conversation.participants.find((p) => p.role === 'AGENT')?.id).toBe(agent.userId);
    expect((await start(c, property.id)).id).toBe(conversation.id);
  });

  it('concurrent starts create exactly one conversation', async () => {
    const agent = await createAgent(ctx);
    const property = await createPublished(ctx, agent);
    const c = await customer(ctx);
    const results = await Promise.all(Array.from({ length: 5 }, () => start(c, property.id)));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await ctx.prisma.conversation.count()).toBe(1);
  });

  it('only customers start listing conversations, and only about published listings', async () => {
    const { agent, property } = await scenario();
    await start(agent, property.id, 403);
    const admin = await adminAuth(ctx, ['super_admin']);
    await ctx
      .http()
      .post('/api/v1/conversations')
      .set(admin.auth)
      .send({ contextType: 'PROPERTY', propertyId: property.id })
      .expect(403);
    await ctx.prisma.property.update({ where: { id: property.id }, data: { status: 'SUSPENDED' } });
    await start(await customer(ctx), property.id, 404);
  });

  it('booking conversations: the booking’s customer or agent, nobody else', async () => {
    await setPricing(ctx);
    const { property, agent } = await rental(ctx);
    const c = await customer(ctx);
    const b = await book(ctx, c, { propertyId: property.id, startDate: inDays(10), quantity: 2 });
    const startBooking = (who: Who) =>
      ctx
        .http()
        .post('/api/v1/conversations')
        .set(who.auth)
        .send({ contextType: 'BOOKING', bookingId: b.id });
    const fromCustomer = (await startBooking(c).expect(200)).body.data as ConversationSummary;
    const fromAgent = (await startBooking(agent).expect(200)).body.data as ConversationSummary;
    expect(fromAgent.id).toBe(fromCustomer.id);
    expect(fromAgent.context).toMatchObject({ type: 'BOOKING', booking: { id: b.id } });
    await startBooking(await customer(ctx)).expect(404);
    await startBooking(await createAgent(ctx)).expect(404);
  });

  it('lists own conversations newest first with cursor pagination and search', async () => {
    const c = await customer(ctx);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const agent = await createAgent(ctx);
      const property = await createPublished(ctx, agent, { title: `Listing number ${i}` });
      const conv = await start(c, property.id);
      await send(c, conv.id, { body: `hi ${i}` });
      ids.push(conv.id);
    }
    const first = (await ctx.http().get('/api/v1/conversations?limit=2').set(c.auth).expect(200))
      .body.data;
    expect(first.items.map((i: ConversationSummary) => i.id)).toEqual([ids[2], ids[1]]);
    const second = (
      await ctx
        .http()
        .get(`/api/v1/conversations?limit=2&cursor=${first.nextCursor}`)
        .set(c.auth)
        .expect(200)
    ).body.data;
    expect(second.items.map((i: ConversationSummary) => i.id)).toEqual([ids[0]]);
    expect(second.nextCursor).toBeNull();
    const found = (
      await ctx.http().get('/api/v1/conversations?search=number%201').set(c.auth).expect(200)
    ).body.data;
    expect(found.items.map((i: ConversationSummary) => i.id)).toEqual([ids[1]]);
    await ctx.http().get('/api/v1/conversations?cursor=garbage').set(c.auth).expect(400);
  });

  it('archiving is personal; a new message brings the conversation back', async () => {
    const { agent, customer: c, conversation } = await scenario();
    await ctx
      .http()
      .post(`/api/v1/conversations/${conversation.id}/archive`)
      .set(c.auth)
      .send({ archived: true })
      .expect(200);
    const list = async (who: Who, archived: boolean) =>
      (await ctx.http().get(`/api/v1/conversations?archived=${archived}`).set(who.auth).expect(200))
        .body.data.items.length as number;
    expect(await list(c, false)).toBe(0);
    expect(await list(c, true)).toBe(1);
    expect(await list(agent, false)).toBe(1);
    await send(agent, conversation.id);
    expect(await list(c, false)).toBe(1);
  });
});

describe('authorization (IDOR)', () => {
  it('non-participants cannot see, read, write or upload — and get "not found"', async () => {
    const { conversation, customer: c } = await scenario();
    const message = await send(c, conversation.id);
    const intruders: Who[] = [await customer(ctx), await createAgent(ctx)];
    for (const who of intruders) {
      await ctx.http().get(`/api/v1/conversations/${conversation.id}`).set(who.auth).expect(404);
      await ctx
        .http()
        .get(`/api/v1/conversations/${conversation.id}/messages`)
        .set(who.auth)
        .expect(404);
      await send(who, conversation.id, { body: 'let me in' }, 404);
      await ctx
        .http()
        .post(`/api/v1/conversations/${conversation.id}/read`)
        .set(who.auth)
        .send({ seq: 1 })
        .expect(404);
      await ctx
        .http()
        .patch(`/api/v1/messages/${message.id}`)
        .set(who.auth)
        .send({ body: 'x' })
        .expect(404);
      await ctx.http().delete(`/api/v1/messages/${message.id}`).set(who.auth).expect(404);
      await ctx
        .http()
        .put(`/api/v1/messages/${message.id}/reaction`)
        .set(who.auth)
        .send({ emoji: '👍' })
        .expect(404);
      await upload(who, conversation.id, await testImage(), 'x.jpg', 404);
      const list = (await ctx.http().get('/api/v1/conversations').set(who.auth).expect(200)).body
        .data;
      expect(list.items).toEqual([]);
    }
  });

  it('participants cannot change each other’s messages', async () => {
    const { agent, customer: c, conversation } = await scenario();
    const mine = await send(c, conversation.id);
    expect(mine.canEdit).toBe(true);
    const theirs = (await page(agent, conversation.id)).items[0]!;
    expect(theirs).toMatchObject({ canEdit: false, canDelete: false, clientKey: null });
    await ctx
      .http()
      .patch(`/api/v1/messages/${mine.id}`)
      .set(agent.auth)
      .send({ body: 'hacked' })
      .expect(403);
    await ctx.http().delete(`/api/v1/messages/${mine.id}`).set(agent.auth).expect(403);
    expect((await page(c, conversation.id)).items[0]!.body).toBe('Hello there');
  });

  it('admins have no participant access; they use the audited admin routes', async () => {
    const { conversation } = await scenario();
    const admin = await adminAuth(ctx, ['super_admin']);
    await ctx.http().get(`/api/v1/conversations/${conversation.id}`).set(admin.auth).expect(403);
    await ctx.http().get('/api/v1/conversations').expect(401);
  });
});

describe('messages', () => {
  it('stores text as plain text: markup is kept verbatim, control characters removed', async () => {
    const { customer: c, conversation } = await scenario();
    const m = await send(c, conversation.id, {
      body: '  <img src=x onerror=alert(1)><script>alert("x")</script>\r\nline2\u0000‮  ',
    });
    expect(m.body).toBe('<img src=x onerror=alert(1)><script>alert("x")</script>\nline2');
    await send(c, conversation.id, { body: 'x'.repeat(4001) }, 422);
    await send(c, conversation.id, { body: '   ' }, 422);
  });

  it('clients cannot forge system messages, metadata, senders or sequence numbers', async () => {
    const { agent, customer: c, conversation } = await scenario();
    const m = await send(c, conversation.id, {
      body: 'Hi',
      type: 'SYSTEM',
      metadata: { event: 'conversation.closed' },
      senderId: agent.userId,
      seq: 999,
      conversationId: '00000000-0000-0000-0000-000000000000',
    });
    expect(m).toMatchObject({
      type: 'TEXT',
      metadata: null,
      seq: 1,
      conversationId: conversation.id,
    });
    expect(m.sender?.id).toBe(c.id);
    const row = await ctx.prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(row).toMatchObject({ type: 'TEXT', metadata: null, senderId: c.id });
  });

  it('paginates by seq: newest page, older pages, and catch-up after a seq', async () => {
    const { agent, customer: c, conversation } = await scenario();
    for (let i = 1; i <= 35; i++) await send(i % 2 ? c : agent, conversation.id, { body: `m${i}` });
    const newest = await page(c, conversation.id);
    expect(newest.items).toHaveLength(30);
    expect(newest.items[0]!.seq).toBe(6);
    expect(newest.items.at(-1)!.seq).toBe(35);
    expect(newest).toMatchObject({ hasMore: true, lastSeq: 35 });
    const older = await page(c, conversation.id, '?before=6');
    expect(older.items.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(older.hasMore).toBe(false);
    // Messages arriving while reading never shift a cursor.
    await send(agent, conversation.id, { body: 'late' });
    const catchUp = await page(c, conversation.id, '?after=35');
    expect(catchUp.items.map((m) => m.body)).toEqual(['late']);
    expect((await page(c, conversation.id, '?before=6')).items).toHaveLength(5);
    await ctx
      .http()
      .get(`/api/v1/conversations/${conversation.id}/messages?before=5&after=1`)
      .set(c.auth)
      .expect(422);
  });

  it('edits own messages within the window, keeping the previous text', async () => {
    const { customer: c, conversation } = await scenario();
    const m = await send(c, conversation.id, { body: 'Is it available?' });
    const edited = (
      await ctx
        .http()
        .patch(`/api/v1/messages/${m.id}`)
        .set(c.auth)
        .send({ body: 'Is it available in May?' })
        .expect(200)
    ).body.data as MessageView;
    expect(edited.body).toBe('Is it available in May?');
    expect(edited.editedAt).not.toBeNull();
    expect(await ctx.prisma.messageRevision.findMany({ where: { messageId: m.id } })).toEqual([
      expect.objectContaining({ body: 'Is it available?' }),
    ]);
    await ctx.prisma.message.update({
      where: { id: m.id },
      data: { createdAt: new Date(Date.now() - 16 * 60_000) },
    });
    const late = await ctx
      .http()
      .patch(`/api/v1/messages/${m.id}`)
      .set(c.auth)
      .send({ body: 'again' })
      .expect(409);
    expect(late.body.code).toBe('MESSAGE_NOT_EDITABLE');
  });

  it('deleting is a soft delete: content disappears for everyone, the row stays', async () => {
    const { agent, customer: c, conversation } = await scenario();
    const m = await send(c, conversation.id, { body: 'my phone is 0803…' });
    await ctx
      .http()
      .put(`/api/v1/messages/${m.id}/reaction`)
      .set(agent.auth)
      .send({ emoji: '👍' })
      .expect(200);
    const deleted = (await ctx.http().delete(`/api/v1/messages/${m.id}`).set(c.auth).expect(200))
      .body.data as MessageView;
    expect(deleted).toMatchObject({ body: null, attachments: [], reactions: [], canDelete: false });
    const seen = (await page(agent, conversation.id)).items[0]!;
    expect(seen).toMatchObject({ id: m.id, body: null });
    expect(seen.deletedAt).not.toBeNull();
    expect((await summary(agent, conversation.id)).lastMessage).toMatchObject({
      deleted: true,
      text: null,
    });
    // Deleting again is harmless; editing is refused; the row cannot be hard-deleted.
    await ctx.http().delete(`/api/v1/messages/${m.id}`).set(c.auth).expect(200);
    await ctx.http().patch(`/api/v1/messages/${m.id}`).set(c.auth).send({ body: 'x' }).expect(409);
    await expect(ctx.prisma.message.delete({ where: { id: m.id } })).rejects.toThrow();
    expect((await ctx.prisma.message.findUniqueOrThrow({ where: { id: m.id } })).body).toBe(
      'my phone is 0803…',
    );
  });

  it('replies quote the original, safely, one level deep', async () => {
    const { agent, customer: c, conversation } = await scenario();
    const q = await send(c, conversation.id, { body: 'How much is the caution fee?' });
    const reply = await send(agent, conversation.id, { body: '₦200,000', replyToId: q.id });
    expect(reply.replyTo).toEqual({
      id: q.id,
      seq: q.seq,
      senderId: c.id,
      senderName: 'Chiamaka Okafor',
      type: 'TEXT',
      text: 'How much is the caution fee?',
      attachmentKind: null,
      deleted: false,
    });
    expect(reply.replyTo).not.toHaveProperty('replyTo');
    await ctx.http().delete(`/api/v1/messages/${q.id}`).set(c.auth).expect(200);
    const after = (await page(agent, conversation.id)).items.find((m) => m.id === reply.id)!;
    expect(after.replyTo).toMatchObject({ deleted: true, text: null });
    await send(agent, conversation.id, { body: 'x', replyToId: q.id }, 422);

    const elsewhere = await scenario();
    const foreign = await send(elsewhere.customer, elsewhere.conversation.id);
    await send(c, conversation.id, { body: 'x', replyToId: foreign.id }, 422);
  });
});

describe('reactions', () => {
  it('adds, changes and removes one reaction per user, with counts and "mine"', async () => {
    const { agent, customer: c, conversation } = await scenario();
    const m = await send(c, conversation.id);
    const react = (who: Who, emoji: string) =>
      ctx.http().put(`/api/v1/messages/${m.id}/reaction`).set(who.auth).send({ emoji });
    expect((await react(agent, '👍').expect(200)).body.data.reactions).toEqual([
      { emoji: '👍', count: 1, mine: true },
    ]);
    expect((await react(c, '👍').expect(200)).body.data.reactions).toEqual([
      { emoji: '👍', count: 2, mine: true },
    ]);
    expect((await react(agent, '❤️').expect(200)).body.data.reactions).toEqual([
      { emoji: '👍', count: 1, mine: false },
      { emoji: '❤️', count: 1, mine: true },
    ]);
    await Promise.all([react(agent, '😂'), react(agent, '😂'), react(agent, '😂')]);
    expect(await ctx.prisma.messageReaction.count({ where: { messageId: m.id } })).toBe(2);
    await expect(
      ctx.prisma.messageReaction.create({
        data: { messageId: m.id, userId: agent.userId, emoji: '🙏' },
      }),
    ).rejects.toThrow();
    const removed = (
      await ctx.http().delete(`/api/v1/messages/${m.id}/reaction`).set(agent.auth).expect(200)
    ).body.data;
    expect(removed.reactions).toEqual([{ emoji: '👍', count: 1, mine: false }]);
    await react(agent, '💩').expect(422);
  });
});

describe('read state', () => {
  it('counts unread messages from others and moves the cursor forward only', async () => {
    const { agent, customer: c, conversation } = await scenario();
    for (let i = 0; i < 3; i++) await send(c, conversation.id);
    expect((await summary(agent, conversation.id)).unreadCount).toBe(3);
    expect((await summary(c, conversation.id)).unreadCount).toBe(0);
    const unread = (
      await ctx.http().get('/api/v1/conversations/unread').set(agent.auth).expect(200)
    ).body.data;
    expect(unread).toEqual({ conversations: 1, messages: 3 });

    const mark = (seq: number) =>
      ctx
        .http()
        .post(`/api/v1/conversations/${conversation.id}/read`)
        .set(agent.auth)
        .send({ seq });
    await Promise.all([mark(1), mark(3), mark(2), mark(99)]);
    expect((await summary(agent, conversation.id)).myLastReadSeq).toBe(3); // clamped to lastSeq
    expect((await mark(1).expect(200)).body.data).toEqual({ lastReadSeq: 3, unreadCount: 0 });
    // The customer sees the agent's read cursor (read receipts).
    const view = await summary(c, conversation.id);
    expect(view.participants.find((p) => p.id === agent.userId)?.lastReadSeq).toBe(3);
    // Sending counts as reading what came before.
    await send(agent, conversation.id);
    expect((await summary(agent, conversation.id)).unreadCount).toBe(0);
  });
});

describe('idempotency', () => {
  it('a retried send returns the original message; concurrent duplicates create one', async () => {
    const { customer: c, conversation } = await scenario();
    const key = clientKey();
    const post = (app: TestContext) =>
      app
        .http()
        .post(`/api/v1/conversations/${conversation.id}/messages`)
        .set(c.auth)
        .send({ clientKey: key, body: 'Only once' });
    const first = await post(ctx).expect(201);
    const retry = await post(ctx).expect(200);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(retry.body.data.clientKey).toBe(key);

    const burstKey = clientKey();
    const burst = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        (i % 2 ? other : ctx)
          .http()
          .post(`/api/v1/conversations/${conversation.id}/messages`)
          .set(c.auth)
          .send({ clientKey: burstKey, body: 'Burst' }),
      ),
    );
    expect(burst.filter((r) => r.status === 201)).toHaveLength(1);
    expect(burst.every((r) => r.status === 201 || r.status === 200)).toBe(true);
    expect(new Set(burst.map((r) => (r.body as { data: MessageView }).data.id)).size).toBe(1);
    expect(await ctx.prisma.message.count({ where: { conversationId: conversation.id } })).toBe(2);
    // Seqs stay gap-free despite the lost races.
    expect((await page(c, conversation.id)).items.map((m) => m.seq)).toEqual([1, 2]);

    const elsewhere = await start(c, (await createPublished(ctx, await createAgent(ctx))).id);
    await ctx
      .http()
      .post(`/api/v1/conversations/${elsewhere.id}/messages`)
      .set(c.auth)
      .send({ clientKey: key, body: 'reuse' })
      .expect(409);
  });
});

describe('attachments', () => {
  it('uploads a photo (re-encoded), sends it, and serves it only to participants', async () => {
    const { agent, customer: c, conversation } = await scenario();
    const { data: photo } = await upload(
      c,
      conversation.id,
      await testImage(800, 600),
      'house.jpg',
    );
    expect(photo).toMatchObject({
      kind: 'IMAGE',
      contentType: 'image/webp',
      fileName: 'house.webp',
    });
    expect(photo.url).toBe(`/api/v1/conversations/${conversation.id}/attachments/${photo.id}`);
    expect(JSON.stringify(photo)).not.toMatch(/chat\/|storage|devdata|\/tmp/);

    // Not sent yet: only the uploader can load it.
    await ctx.http().get(photo.url).set(agent.auth).expect(404);
    const m = await send(c, conversation.id, { body: 'The view', attachmentIds: [photo.id] });
    expect(m).toMatchObject({
      type: 'IMAGE',
      attachments: [expect.objectContaining({ id: photo.id })],
    });

    const file = await ctx.http().get(photo.url).set(agent.auth).expect(200);
    expect(file.headers['content-type']).toBe('image/webp');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['cache-control']).toBe('private, max-age=300');
    expect(file.headers['content-security-policy']).toContain('sandbox');
    await ctx.http().get(`${photo.thumbnailUrl}`).set(agent.auth).expect(200);
    await ctx
      .http()
      .get(photo.url)
      .set((await customer(ctx)).auth)
      .expect(404);
    await ctx.http().get(photo.url).expect(401);

    // The public media route never serves private chat files.
    const row = await ctx.prisma.messageAttachment.findUniqueOrThrow({ where: { id: photo.id } });
    expect(row.storageKey.startsWith(`chat/${conversation.id}/`)).toBe(true);
    await ctx.http().get(`/api/media/${row.storageKey}`).expect(404);

    // Deleted message → its files are gone for participants.
    await ctx.http().delete(`/api/v1/messages/${m.id}`).set(c.auth).expect(200);
    await ctx.http().get(photo.url).set(agent.auth).expect(404);
  });

  it('accepts documents by content, refuses dangerous or disguised files and oversized ones', async () => {
    const { customer: c, conversation } = await scenario();
    const pdf = await upload(c, conversation.id, Buffer.from('%PDF-1.7\n1 0 obj\n'), 'lease.pdf');
    expect(pdf.data).toMatchObject({ kind: 'FILE', contentType: 'application/pdf' });
    const file = await ctx.http().get(pdf.data.url).set(c.auth).expect(200);
    expect(file.headers['content-disposition']).toMatch(/^inline; filename="lease.pdf"/);
    const csv = await upload(c, conversation.id, Buffer.from('a,b\n1,2\n'), '../../rent.csv');
    expect(csv.data.fileName).toBe('rent.csv');
    const csvFile = await ctx.http().get(csv.data.url).set(c.auth).expect(200);
    expect(csvFile.headers['content-disposition']).toMatch(/^attachment;/);

    for (const [bytes, name] of [
      [Buffer.from('MZ\x90\x00\x03\x00\x00\x00'), 'invoice.pdf'],
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'logo.svg'],
      [Buffer.from('<html><script>alert(1)</script></html>'), 'page.html'],
      [Buffer.from('#!/bin/sh\0rm -rf'), 'notes.txt'],
    ] as const) {
      const res = await upload(c, conversation.id, bytes, name, 422);
      expect(res.code).toBe('INVALID_FILE');
    }
    const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(21 * 1024 * 1024, 32)]);
    const tooBig = await upload(c, conversation.id, big, 'big.pdf', 422);
    expect(tooBig.message).toMatch(/too large/);
    expect(
      await ctx.prisma.messageAttachment.count({ where: { conversationId: conversation.id } }),
    ).toBe(2);
  });

  it('only your own, unsent uploads in this conversation can be attached', async () => {
    const { agent, customer: c, conversation } = await scenario();
    const { data: agentsFile } = await upload(
      agent,
      conversation.id,
      Buffer.from('%PDF-1.4'),
      'a.pdf',
    );
    await send(c, conversation.id, { attachmentIds: [agentsFile.id] }, 422);
    const { data: mine } = await upload(c, conversation.id, Buffer.from('%PDF-1.4'), 'b.pdf');
    await send(c, conversation.id, { attachmentIds: [mine.id] });
    await send(c, conversation.id, { attachmentIds: [mine.id] }, 422); // already sent
  });

  it('unsent uploads are cleaned up after a day', async () => {
    const { customer: c, conversation } = await scenario();
    const { data } = await upload(c, conversation.id, Buffer.from('%PDF-1.4'), 'a.pdf');
    const service = ctx.app.get(AttachmentsService);
    expect(await service.cleanupUnattached()).toBe(0);
    expect(await service.cleanupUnattached(new Date(Date.now() + 25 * 3600_000))).toBe(1);
    expect(await ctx.prisma.messageAttachment.findUnique({ where: { id: data.id } })).toBeNull();
  });
});

describe('notifications', () => {
  it('emails one digest per unread burst, never the content, and not after reading', async () => {
    const { agent, customer: c, conversation } = await scenario();
    const notifications = ctx.app.get(ChatNotificationsService);
    for (let i = 0; i < 4; i++) await send(c, conversation.id, { body: `secret detail ${i}` });
    const later = Date.now() + 11 * 60_000;
    expect(await notifications.sendDue(Date.now())).toBe(0); // not due yet
    const [a, b] = await Promise.all([
      notifications.sendDue(later),
      other.app.get(ChatNotificationsService).sendDue(later),
    ]);
    expect(a + b).toBe(1);
    const mail = ctx.mail.lastTo(agent.email)!;
    expect(mail.subject).toMatch(/4 messages/);
    expect(mail.text).not.toMatch(/secret detail/);
    expect(mail.text).toContain(`/agent/messages?c=${conversation.id}`);
    expect(await notifications.sendDue(later)).toBe(0);

    // Reading cancels a pending digest; reactions never email.
    await send(c, conversation.id, { body: 'one more' });
    await ctx
      .http()
      .post(`/api/v1/conversations/${conversation.id}/read`)
      .set(agent.auth)
      .send({ seq: 99 })
      .expect(200);
    const m = await send(agent, conversation.id);
    await ctx
      .http()
      .put(`/api/v1/messages/${m.id}/reaction`)
      .set(c.auth)
      .send({ emoji: '❤️' })
      .expect(200);
    ctx.mail.clear();
    expect(await notifications.sendDue(Date.now() + 11 * 60_000)).toBe(1); // only the customer, for the agent's message
    expect(ctx.mail.sent.map((x) => x.to)).toEqual([c.email]);
  });
});

describe('moderation (admin)', () => {
  it('support can read (audited) and moderate; other admins cannot', async () => {
    const { agent, customer: c, conversation } = await scenario();
    const m = await send(c, conversation.id, { body: 'Pay me outside HavenHub' });
    const support = await adminAuth(ctx, ['support_admin']);
    const general = await adminAuth(ctx, ['admin']);
    const finance = await adminAuth(ctx, ['finance_admin']);

    for (const denied of [general, finance]) {
      await ctx.http().get('/api/v1/admin/conversations').set(denied.auth).expect(403);
      await ctx
        .http()
        .get(`/api/v1/admin/conversations/${conversation.id}`)
        .set(denied.auth)
        .expect(403);
    }
    await ctx.http().get('/api/v1/admin/conversations').set(c.auth).expect(403);

    const list = (
      await ctx
        .http()
        .get(`/api/v1/admin/conversations?search=${encodeURIComponent(c.email)}`)
        .set(support.auth)
        .expect(200)
    ).body.data;
    expect(list.items.map((i: { id: string }) => i.id)).toEqual([conversation.id]);
    const detail = (
      await ctx
        .http()
        .get(`/api/v1/admin/conversations/${conversation.id}`)
        .set(support.auth)
        .expect(200)
    ).body.data;
    expect(detail.messages[0]).toMatchObject({ id: m.id, body: 'Pay me outside HavenHub' });
    expect(await ctx.prisma.auditLog.count({ where: { action: 'conversation.viewed' } })).toBe(1);

    await ctx
      .http()
      .post(`/api/v1/admin/messages/${m.id}/remove`)
      .set(support.auth)
      .send({ reason: 'Off-platform payment request' })
      .expect(200);
    expect((await page(agent, conversation.id)).items[0]!.body).toBeNull();
    const reviewed = (
      await ctx
        .http()
        .get(`/api/v1/admin/conversations/${conversation.id}`)
        .set(support.auth)
        .expect(200)
    ).body.data;
    expect(reviewed.messages[0]).toMatchObject({
      body: null,
      originalBody: 'Pay me outside HavenHub',
      deletedBy: { id: support.id },
    });
    expect(await ctx.prisma.auditLog.count({ where: { action: 'message.moderated' } })).toBe(1);

    await ctx
      .http()
      .post(`/api/v1/admin/conversations/${conversation.id}/status`)
      .set(support.auth)
      .send({ status: 'CLOSED', reason: 'Repeated policy violations' })
      .expect(200);
    const closed = await ctx
      .http()
      .post(`/api/v1/conversations/${conversation.id}/messages`)
      .set(c.auth)
      .send({ clientKey: clientKey(), body: 'hello?' })
      .expect(409);
    expect(closed.body.code).toBe('CONVERSATION_CLOSED');
    const history = await page(c, conversation.id);
    expect(history.items.at(-1)).toMatchObject({ type: 'SYSTEM', sender: null });
    expect((await summary(c, conversation.id)).status).toBe('CLOSED');
    await ctx
      .http()
      .post(`/api/v1/admin/conversations/${conversation.id}/status`)
      .set(support.auth)
      .send({ status: 'OPEN', reason: 'Resolved' })
      .expect(200);
    await send(c, conversation.id, { body: 'thanks' });
    await ctx
      .http()
      .post(`/api/v1/admin/conversations/${conversation.id}/status`)
      .set(general.auth)
      .send({ status: 'CLOSED', reason: 'nope nope' })
      .expect(403);
  });
});

describe('real-time', () => {
  it('rejects connections without a valid ticket or token; tickets are single-use', async () => {
    const c = await customer(ctx);
    await expect(socket(ctx, {})).rejects.toThrow('unauthorized');
    await expect(socket(ctx, { ticket: 'a'.repeat(43) })).rejects.toThrow('unauthorized');
    await expect(socket(ctx, { token: 'not-a-token' })).rejects.toThrow('unauthorized');
    const t = await ticket(c);
    await socket(ctx, { ticket: t });
    await expect(socket(ctx, { ticket: t })).rejects.toThrow('unauthorized');
    await socket(ctx, { token: tokenOf(c) });
  });

  it('shutting down drops sockets so clients reconnect elsewhere (and does not hang)', async () => {
    const leaving = await createTestContext();
    const c = await customer(ctx);
    const s = await socket(leaving, { token: tokenOf(c) });
    const reason = new Promise<string>((resolve) => s.once('disconnect', resolve));
    const started = Date.now();
    await leaving.close();
    expect(Date.now() - started).toBeLessThan(5000);
    // A transport close — not "io server disconnect" — so the client retries.
    expect(await reason).toBe('transport close');
  });

  it('expired tickets are refused', async () => {
    const c = await customer(ctx);
    const t = await ticket(c);
    const keys = await ctx.app.get(RedisService).client.keys('rt:ticket:*');
    expect(keys).toHaveLength(1);
    expect(await ctx.app.get(RedisService).client.ttl(keys[0]!)).toBeGreaterThan(50);
    await ctx.app.get(RedisService).client.pexpire(keys[0]!, 1);
    await new Promise((r) => setTimeout(r, 20));
    await expect(socket(ctx, { ticket: t })).rejects.toThrow('unauthorized');
  });

  it('delivers events to participants only, across API instances', async () => {
    const { agent, customer: c, conversation } = await scenario();
    const agentSocket = await socket(other, { ticket: await ticket(agent) }); // another instance
    const customerSocket = await socket(ctx, { token: tokenOf(c) });
    const outsider = await socket(ctx, { token: tokenOf(await customer(ctx)) });
    const outsiderEvents = silence(outsider, 'message.created', 1500);

    const created = next(agentSocket, 'message.created');
    const echoed = next(customerSocket, 'message.created');
    const sent = await send(c, conversation.id, { body: 'Live!' });
    const received = await created;
    expect(received.message).toMatchObject({ id: sent.id, body: 'Live!', clientKey: null });
    expect(received.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await echoed).message.clientKey).toBe(sent.clientKey); // own view
    expect(await outsiderEvents).toBe(0);

    const reaction = next(customerSocket, 'message.reaction.updated');
    await ctx
      .http()
      .put(`/api/v1/messages/${sent.id}/reaction`)
      .set(agent.auth)
      .send({ emoji: '😮' })
      .expect(200);
    expect((await reaction).reactions).toEqual([{ emoji: '😮', count: 1, mine: false }]);

    const read = next(customerSocket, 'message.read');
    await ctx
      .http()
      .post(`/api/v1/conversations/${conversation.id}/read`)
      .set(agent.auth)
      .send({ seq: 1 })
      .expect(200);
    expect(await read).toMatchObject({ userId: agent.userId, lastReadSeq: 1 });

    const updated = next(agentSocket, 'message.updated');
    await ctx
      .http()
      .patch(`/api/v1/messages/${sent.id}`)
      .set(c.auth)
      .send({ body: 'Live (edited)' })
      .expect(200);
    expect((await updated).message.body).toBe('Live (edited)');
    const deleted = next(agentSocket, 'message.deleted');
    await ctx.http().delete(`/api/v1/messages/${sent.id}`).set(c.auth).expect(200);
    expect((await deleted).message).toMatchObject({ id: sent.id, body: null });
  });

  it('a retried send does not emit a second message event', async () => {
    const { agent, customer: c, conversation } = await scenario();
    const agentSocket = await socket(ctx, { token: tokenOf(agent) });
    const key = clientKey();
    const post = () =>
      ctx
        .http()
        .post(`/api/v1/conversations/${conversation.id}/messages`)
        .set(c.auth)
        .send({ clientKey: key, body: 'once' });
    const events = silence(agentSocket, 'message.created', 1500);
    await post().expect(201);
    await post().expect(200);
    await post().expect(200);
    expect(await events).toBe(1);
  });

  it('typing indicators reach the other participant only and are never stored', async () => {
    const { agent, customer: c, conversation } = await scenario();
    const agentSocket = await socket(ctx, { token: tokenOf(agent) });
    const customerSocket = await socket(other, { token: tokenOf(c) });
    const self = silence(customerSocket, 'typing.started', 1200);
    const typing = next(agentSocket, 'typing.started');
    customerSocket.emit('typing.start', { conversationId: conversation.id });
    expect(await typing).toMatchObject({ conversationId: conversation.id, userId: c.id });
    expect(await self).toBe(0);
    const stopped = next(agentSocket, 'typing.stopped');
    customerSocket.emit('typing.stop', { conversationId: conversation.id });
    await stopped;

    // A non-participant's typing is ignored; garbage payloads too.
    const outsider = await socket(ctx, { token: tokenOf(await customer(ctx)) });
    const leaked = silence(agentSocket, 'typing.started', 1200);
    outsider.emit('typing.start', { conversationId: conversation.id });
    outsider.emit('typing.start', 'garbage');
    outsider.emit('typing.start', { conversationId: '../../etc' });
    expect(await leaked).toBe(0);
  });

  it('revoked sessions are disconnected; a reconnecting client catches up over REST', async () => {
    const { agent, customer: c, conversation } = await scenario();
    const agentSocket = await socket(ctx, { token: tokenOf(agent) });
    const ended = new Promise<void>((resolve) => agentSocket.once('disconnect', () => resolve()));
    await ctx.http().post('/api/v1/auth/logout').set(agent.auth).expect(200);
    expect(await ctx.app.get(RealtimeGateway).revalidateSessions()).toBe(1);
    await ended;

    // While offline, messages keep arriving; nothing is lost.
    await send(c, conversation.id, { body: 'while you were away 1' });
    await send(c, conversation.id, { body: 'while you were away 2' });
    const fresh = await loginToken(ctx, { email: agent.email, password: PASSWORD });
    const back = { auth: { Authorization: `Bearer ${fresh.tokens.accessToken}` } } as Agent;
    await socket(ctx, { token: tokenOf(back) });
    const missed = await page(back, conversation.id, '?after=0');
    expect(missed.items.map((m) => m.body)).toEqual([
      'while you were away 1',
      'while you were away 2',
    ]);
  });
});

'use client';

import type {
  ConversationSummary,
  MessagePage,
  MessageReactionEmoji,
  MessageView,
} from '@havenhub/shared';
import { Alert, Badge, Button, Spinner, cn } from '@havenhub/ui';
import { Archive, ArchiveRestore, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/lib/api/client';
import { useRealtimeEvent, useReconnect, type RealtimeStatus } from '@/lib/realtime';
import { ChatAvatar } from './chat-avatar';
import { contextLine, counterpart, dayLabel, newClientKey, sameDay } from './chat-utils';
import { Composer } from './composer';
import { MessageItem, PendingItem, type PendingMessage } from './message-item';

const ROLE_LABEL = {
  CUSTOMER: 'Customer',
  AGENT: 'Agent',
  ADMIN: 'HavenHub',
  SYSTEM: 'HavenHub',
} as const;

/**
 * One conversation. The REST API is the source of truth; real-time events
 * only tell this view to apply a change or to fetch what it missed. Messages
 * are kept by id and ordered by seq, so duplicate events are harmless.
 */
export function ConversationThread({
  conversation,
  viewerId,
  area,
  status,
  onBack,
  onChanged,
}: {
  conversation: ConversationSummary;
  viewerId: string;
  area: 'account' | 'agent';
  status: RealtimeStatus;
  onBack: () => void;
  onChanged: (c: Partial<ConversationSummary> & { id: string }) => void;
}) {
  const id = conversation.id;
  const [messages, setMessages] = useState<Map<string, MessageView>>(new Map());
  const [pending, setPending] = useState<
    (PendingMessage & { attachmentIds: string[]; replyToId?: string })[]
  >([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<MessageView | null>(null);
  const [editing, setEditing] = useState<MessageView | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  // Read receipts: the other participant's cursor, as loaded and as updated live.
  const [liveReadSeq, setLiveReadSeq] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const readSent = useRef(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const person = counterpart(conversation, viewerId);
  const ordered = useMemo(() => [...messages.values()].sort((a, b) => a.seq - b.seq), [messages]);
  const maxSeq = ordered.at(-1)?.seq ?? 0;
  const otherReadSeq = Math.max(person?.lastReadSeq ?? 0, liveReadSeq);
  const maxSeqRef = useRef(0);
  useEffect(() => {
    maxSeqRef.current = maxSeq;
  }, [maxSeq]);

  const upsert = useCallback((items: MessageView[]) => {
    if (items.length === 0) return;
    setMessages((prev) => {
      const next = new Map(prev);
      for (const m of items) next.set(m.id, m);
      return next;
    });
    const keys = new Set(items.map((m) => m.clientKey).filter(Boolean));
    if (keys.size) setPending((p) => p.filter((x) => !keys.has(x.clientKey)));
  }, []);

  // Initial load (newest page). The thread is remounted per conversation
  // (keyed by id), so there is no state to reset here.
  useEffect(() => {
    let active = true;
    void api<MessagePage>('GET', `/conversations/${id}/messages?limit=30`).then((res) => {
      if (!active) return;
      setLoading(false);
      if (!res.success) {
        setError(res.message);
        return;
      }
      upsert(res.data.items);
      setHasOlder(res.data.hasMore);
    });
    return () => {
      active = false;
    };
  }, [id, upsert]);

  /** Fetches everything after the newest message we have (reconnects, gaps). */
  const catchUp = useCallback(async () => {
    let after = maxSeqRef.current;
    for (let i = 0; i < 10; i++) {
      const res = await api<MessagePage>(
        'GET',
        `/conversations/${id}/messages?after=${after}&limit=100`,
      );
      if (!res.success) return;
      upsert(res.data.items);
      after = res.data.items.at(-1)?.seq ?? after;
      if (!res.data.hasMore) return;
    }
  }, [id, upsert]);

  useReconnect(() => void catchUp());

  useRealtimeEvent(
    'message.created',
    (e) => {
      if (e.conversationId !== id) return;
      if (e.message.seq > maxSeqRef.current + 1) void catchUp();
      upsert([e.message]);
      if (e.message.sender?.id !== viewerId) setTyping(null);
    },
    status,
  );
  useRealtimeEvent(
    'message.updated',
    (e) => e.conversationId === id && upsert([e.message]),
    status,
  );
  useRealtimeEvent(
    'message.deleted',
    (e) => e.conversationId === id && upsert([e.message]),
    status,
  );
  useRealtimeEvent(
    'message.reaction.updated',
    (e) => {
      if (e.conversationId !== id) return;
      setMessages((prev) => {
        const m = prev.get(e.messageId);
        if (!m) return prev;
        return new Map(prev).set(m.id, { ...m, reactions: e.reactions });
      });
    },
    status,
  );
  useRealtimeEvent(
    'message.read',
    (e) => {
      if (e.conversationId === id && e.userId !== viewerId) {
        setLiveReadSeq((s) => Math.max(s, e.lastReadSeq));
      }
    },
    status,
  );
  useRealtimeEvent(
    'typing.started',
    (e) => {
      if (e.conversationId !== id || e.userId === viewerId) return;
      const who = conversation.participants.find((p) => p.id === e.userId)?.name ?? 'Someone';
      setTyping(who);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTyping(null), 6000);
    },
    status,
  );
  useRealtimeEvent('typing.stopped', (e) => e.conversationId === id && setTyping(null), status);

  // Mark as read while the conversation is on screen.
  useEffect(() => {
    if (maxSeq <= readSent.current || maxSeq <= conversation.myLastReadSeq) return;
    if (document.visibilityState !== 'visible') return;
    const timer = setTimeout(() => {
      readSent.current = maxSeq;
      void api<{ lastReadSeq: number; unreadCount: number }>('POST', `/conversations/${id}/read`, {
        seq: maxSeq,
      }).then(
        (res) =>
          res.success &&
          onChanged({ id, myLastReadSeq: res.data.lastReadSeq, unreadCount: res.data.unreadCount }),
      );
    }, 400);
    return () => clearTimeout(timer);
  }, [maxSeq, id, conversation.myLastReadSeq, onChanged]);

  // Keep the newest message in view unless the reader scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [ordered.length, pending.length, typing]);

  async function loadOlder() {
    const oldest = ordered[0]?.seq;
    if (!oldest) return;
    const el = scroller.current;
    const before = el ? el.scrollHeight - el.scrollTop : 0;
    setLoadingOlder(true);
    const res = await api<MessagePage>(
      'GET',
      `/conversations/${id}/messages?before=${oldest}&limit=30`,
    );
    setLoadingOlder(false);
    if (!res.success) {
      setActionError(res.message);
      return;
    }
    stickToBottom.current = false;
    upsert(res.data.items);
    setHasOlder(res.data.hasMore);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - before;
    });
  }

  async function deliver(item: {
    clientKey: string;
    body: string;
    attachmentIds: string[];
    replyToId?: string;
  }) {
    setPending((p) =>
      p.map((x) =>
        x.clientKey === item.clientKey ? { ...x, status: 'sending', error: undefined } : x,
      ),
    );
    const res = await api<MessageView>('POST', `/conversations/${id}/messages`, {
      clientKey: item.clientKey,
      body: item.body || undefined,
      attachmentIds: item.attachmentIds,
      replyToId: item.replyToId,
    });
    if (res.success) upsert([res.data]);
    else
      setPending((p) =>
        p.map((x) =>
          x.clientKey === item.clientKey ? { ...x, status: 'failed', error: res.message } : x,
        ),
      );
  }

  function send(body: string, attachmentIds: string[]) {
    const item = {
      clientKey: newClientKey(),
      body: body.trim(),
      attachmentIds,
      replyToId: replyTo?.id,
      status: 'sending' as const,
    };
    stickToBottom.current = true;
    setPending((p) => [...p, item]);
    setReplyTo(null);
    void deliver(item);
  }

  async function saveEdit(message: MessageView, body: string) {
    const res = await api<MessageView>('PATCH', `/messages/${message.id}`, { body });
    if (!res.success) {
      setActionError(res.message);
      return false;
    }
    upsert([res.data]);
    setEditing(null);
    return true;
  }

  async function remove(message: MessageView) {
    const res = await api<MessageView>('DELETE', `/messages/${message.id}`);
    if (res.success) upsert([res.data]);
    else setActionError(res.message);
  }

  async function react(message: MessageView, emoji: MessageReactionEmoji | null) {
    const res = emoji
      ? await api<MessageView>('PUT', `/messages/${message.id}/reaction`, { emoji })
      : await api<MessageView>('DELETE', `/messages/${message.id}/reaction`);
    if (res.success) upsert([res.data]);
    else setActionError(res.message);
  }

  async function toggleArchive() {
    const res = await api<ConversationSummary>('POST', `/conversations/${id}/archive`, {
      archived: !conversation.archived,
    });
    if (res.success) onChanged(res.data);
  }

  const jumpTo = (messageId: string) =>
    document
      .getElementById(`m-${messageId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const ctx = conversation.context;
  const contextHref =
    ctx.type === 'PROPERTY'
      ? `/properties/${ctx.property.slug}`
      : `/${area}/bookings/${ctx.booking.id}`;
  const closed = conversation.status === 'CLOSED';

  return (
    <section
      aria-label={`Conversation with ${person?.name ?? 'participant'}`}
      className="flex h-full min-h-0 flex-col"
    >
      <header className="flex items-center gap-3 border-b border-border px-3 py-3 sm:px-4">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className="grid size-9 place-items-center rounded-full hover:bg-surface-secondary lg:hidden"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </button>
        <ChatAvatar name={person?.name ?? '?'} url={person?.avatarUrl ?? null} />
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 truncate font-semibold text-text">
            {person?.name ?? 'Conversation'}
            {person && <Badge className="hidden sm:inline-flex">{ROLE_LABEL[person.role]}</Badge>}
          </h2>
          <Link
            href={contextHref}
            className="block truncate text-xs text-text-secondary hover:text-text hover:underline"
          >
            {contextLine(conversation)}
          </Link>
        </div>
        <span className="hidden items-center gap-1.5 text-xs text-text-muted sm:flex" role="status">
          <span
            aria-hidden
            className={cn('size-2 rounded-full', status === 'live' ? 'bg-success' : 'bg-warning')}
          />
          {status === 'live' ? 'Live' : status === 'connecting' ? 'Reconnecting…' : 'Offline'}
        </span>
        <button
          type="button"
          onClick={toggleArchive}
          aria-label={conversation.archived ? 'Move to inbox' : 'Archive conversation'}
          title={conversation.archived ? 'Move to inbox' : 'Archive'}
          className="grid size-9 place-items-center rounded-full text-text-secondary hover:bg-surface-secondary hover:text-text"
        >
          {conversation.archived ? (
            <ArchiveRestore aria-hidden className="size-5" />
          ) : (
            <Archive aria-hidden className="size-5" />
          )}
        </button>
      </header>

      {status !== 'live' && (
        <p
          role="status"
          className="border-b border-border bg-warning-subtle px-4 py-1.5 text-center text-xs text-warning sm:hidden"
        >
          {status === 'connecting'
            ? 'Reconnecting… new messages will appear when you are back online.'
            : 'Offline'}
        </p>
      )}
      {actionError && (
        <Alert tone="error" className="m-3 flex items-start justify-between gap-3">
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="font-semibold underline"
          >
            Dismiss
          </button>
        </Alert>
      )}

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5"
      >
        {loading && (
          <p
            role="status"
            className="flex items-center justify-center gap-2 py-10 text-sm text-text-secondary"
          >
            <Spinner /> Loading messages…
          </p>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        {hasOlder && !loading && (
          <div className="mb-3 flex justify-center">
            <Button variant="ghost" size="sm" onClick={loadOlder} loading={loadingOlder}>
              Load earlier messages
            </Button>
          </div>
        )}
        {!loading && !error && ordered.length === 0 && pending.length === 0 && (
          <p className="py-10 text-center text-sm text-text-secondary">
            Say hello — messages about {contextLine(conversation)} appear here.
          </p>
        )}
        <ol
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label="Messages"
          className="flex flex-col"
        >
          {ordered.map((m, i) => {
            const prev = ordered[i - 1];
            const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
            return (
              <MessageRow key={m.id} label={newDay ? dayLabel(m.createdAt) : null}>
                <MessageItem
                  message={m}
                  own={m.sender?.id === viewerId}
                  showSender={!prev || newDay || prev.sender?.id !== m.sender?.id}
                  readByOther={otherReadSeq >= m.seq}
                  onReply={setReplyTo}
                  onEdit={setEditing}
                  onDelete={(x) => void remove(x)}
                  onReact={(x, emoji) => void react(x, emoji)}
                  onJumpTo={jumpTo}
                />
              </MessageRow>
            );
          })}
          {pending.map((p) => (
            <PendingItem key={p.clientKey} pending={p} onRetry={() => void deliver(p)} />
          ))}
        </ol>
        {typing && (
          <p className="mt-2 text-xs text-text-muted" role="status">
            {typing} is typing…
          </p>
        )}
      </div>

      {closed ? (
        <p className="border-t border-border bg-surface-secondary px-4 py-4 text-center text-sm text-text-secondary">
          This conversation was closed by HavenHub support. You can still read it.
        </p>
      ) : (
        <Composer
          conversationId={id}
          disabled={closed}
          replyTo={replyTo}
          editing={editing}
          onCancelReply={() => setReplyTo(null)}
          onCancelEdit={() => setEditing(null)}
          onSend={send}
          onSaveEdit={saveEdit}
        />
      )}
    </section>
  );
}

function MessageRow({ label, children }: { label: string | null; children: React.ReactNode }) {
  return (
    <>
      {label && (
        <li className="my-3 flex items-center gap-3 text-xs text-text-muted" aria-hidden>
          <span className="h-px flex-1 bg-border" />
          {label}
          <span className="h-px flex-1 bg-border" />
        </li>
      )}
      {children}
    </>
  );
}

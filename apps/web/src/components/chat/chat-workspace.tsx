'use client';

import type { ConversationPage, ConversationSummary } from '@havenhub/shared';
import { cn } from '@havenhub/ui';
import { MessageSquare } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api } from '@/lib/api/client';
import { useRealtimeConnection, useRealtimeEvent, useReconnect } from '@/lib/realtime';
import { ConversationList } from './conversation-list';
import { ConversationThread } from './conversation-thread';

/**
 * Customer and agent messaging: conversation list and the open thread side
 * by side on large screens, one at a time on phones. The open conversation
 * lives in the URL (`?c=<id>`), so it survives reloads and can be linked.
 */
export function ChatWorkspace({
  viewerId,
  area,
}: {
  viewerId: string;
  area: 'account' | 'agent' | 'admin';
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = params.get('c');
  const status = useRealtimeConnection();

  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  /** The open conversation when it is not in the loaded page (deep link, other folder). */
  const [fetched, setFetched] = useState<ConversationSummary | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  async function fetchPage(cursor?: string) {
    const qs = new URLSearchParams({ archived: String(archived), limit: '20' });
    if (query) qs.set('search', query);
    if (cursor) qs.set('cursor', cursor);
    return api<ConversationPage>('GET', `/conversations?${qs}`);
  }

  useEffect(() => {
    let active = true;
    const qs = new URLSearchParams({ archived: String(archived), limit: '20' });
    if (query) qs.set('search', query);
    void api<ConversationPage>('GET', `/conversations?${qs}`).then((res) => {
      if (!active) return;
      setLoading(false);
      if (!res.success) {
        setError(res.message);
        return;
      }
      setError(null);
      setItems(res.data.items);
      setNextCursor(res.data.nextCursor);
    });
    return () => {
      active = false;
    };
  }, [archived, query, reloadKey]);
  useReconnect(() => setReloadKey((k) => k + 1));

  async function loadMore() {
    if (!nextCursor) return;
    setLoading(true);
    const res = await fetchPage(nextCursor);
    setLoading(false);
    if (!res.success) {
      setError(res.message);
      return;
    }
    setItems((prev) => [...prev, ...res.data.items]);
    setNextCursor(res.data.nextCursor);
  }

  const listed = selectedId ? items.find((c) => c.id === selectedId) : undefined;
  const selected = listed ?? (fetched && fetched.id === selectedId ? fetched : null);

  useEffect(() => {
    if (!selectedId || items.some((c) => c.id === selectedId)) return;
    let active = true;
    void api<ConversationSummary>('GET', `/conversations/${selectedId}`).then((res) => {
      if (!active) return;
      if (res.success) setFetched(res.data);
      else setError(res.message);
    });
    return () => {
      active = false;
    };
  }, [selectedId, items]);

  function patch(change: Partial<ConversationSummary> & { id: string }) {
    setItems((prev) => prev.map((c) => (c.id === change.id ? { ...c, ...change } : c)));
    setFetched((f) => (f && f.id === change.id ? { ...f, ...change } : f));
  }

  function upsertTop(c: ConversationSummary) {
    if (c.archived !== archived) {
      setItems((prev) => prev.filter((x) => x.id !== c.id));
      setFetched((f) => (f && f.id === c.id ? c : f));
      return;
    }
    setItems((prev) =>
      [c, ...prev.filter((x) => x.id !== c.id)].sort((a, b) =>
        b.lastActivityAt.localeCompare(a.lastActivityAt),
      ),
    );
  }

  useRealtimeEvent('conversation.created', (e) => upsertTop(e.conversation), status);
  useRealtimeEvent('conversation.updated', (e) => upsertTop(e.conversation), status);
  // Refresh a conversation's summary (preview, unread, order) from the API.
  const refreshSummary = (conversationId: string) =>
    void api<ConversationSummary>('GET', `/conversations/${conversationId}`).then(
      (res) => res.success && upsertTop(res.data),
    );
  useRealtimeEvent('message.created', (e) => refreshSummary(e.conversationId), status);
  useRealtimeEvent('message.updated', (e) => refreshSummary(e.conversationId), status);
  useRealtimeEvent('message.deleted', (e) => refreshSummary(e.conversationId), status);
  useRealtimeEvent(
    'message.read',
    (e) => {
      if (e.userId === viewerId) {
        patch({
          id: e.conversationId,
          myLastReadSeq: e.lastReadSeq,
          ...(e.conversationId === selectedId ? { unreadCount: 0 } : {}),
        });
      }
    },
    status,
  );

  const open = (id: string | null) => {
    const qs = new URLSearchParams(params.toString());
    if (id) qs.set('c', id);
    else qs.delete('c');
    router.replace(`${pathname}${qs.size ? `?${qs}` : ''}`, { scroll: false });
  };

  return (
    <div className="grid h-[calc(100dvh-13rem)] min-h-[30rem] grid-cols-[minmax(0,1fr)] overflow-hidden rounded-card border border-border bg-surface shadow-card lg:h-[calc(100dvh-12rem)] lg:grid-cols-[340px_minmax(0,1fr)]">
      <div className={cn('min-h-0 border-border lg:border-r', selectedId && 'hidden lg:block')}>
        <ConversationList
          items={items}
          viewerId={viewerId}
          selectedId={selectedId}
          onSelect={open}
          loading={loading}
          error={error}
          nextCursor={nextCursor}
          onLoadMore={() => void loadMore()}
          search={search}
          onSearch={setSearch}
          archived={archived}
          onArchived={(v) => {
            setArchived(v);
            setItems([]);
            setLoading(true);
          }}
        />
      </div>
      <div className={cn('min-h-0', !selectedId && 'hidden lg:block')}>
        {selected ? (
          <ConversationThread
            key={selected.id}
            conversation={selected}
            viewerId={viewerId}
            area={area}
            status={status}
            onBack={() => open(null)}
            onChanged={(c) => {
              patch(c);
              if ('archived' in c && c.archived !== archived) {
                setItems((prev) => prev.filter((x) => x.id !== c.id));
              }
            }}
          />
        ) : (
          <div className="hidden h-full flex-col items-center justify-center gap-3 p-8 text-center lg:flex">
            <span className="grid size-14 place-items-center rounded-full bg-surface-secondary text-text-secondary">
              <MessageSquare aria-hidden className="size-6" />
            </span>
            <p className="font-medium text-text">Select a conversation</p>
            <p className="max-w-xs text-sm text-text-secondary">
              {area === 'agent'
                ? 'Messages from customers about your listings and bookings appear here.'
                : area === 'admin'
                  ? 'Support conversations you have joined appear here.'
                  : 'Message an agent from any listing or booking to start a conversation.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

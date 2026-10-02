'use client';

import type { ConversationPage, ConversationSummary } from '@havenhub/shared';
import { Alert, Button, Input, Spinner, cn } from '@havenhub/ui';
import { MessageSquare, Search } from 'lucide-react';

import { ChatAvatar } from './chat-avatar';
import { contextLine, counterpart, formatListTime } from './chat-utils';

/** Inbox / archived list with unread badges. Data comes from ChatWorkspace. */
export function ConversationList({
  items,
  viewerId,
  selectedId,
  onSelect,
  loading,
  error,
  nextCursor,
  onLoadMore,
  search,
  onSearch,
  archived,
  onArchived,
}: {
  items: ConversationSummary[];
  viewerId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  error: string | null;
  nextCursor: ConversationPage['nextCursor'];
  onLoadMore: () => void;
  search: string;
  onSearch: (value: string) => void;
  archived: boolean;
  onArchived: (value: boolean) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-3 border-b border-border p-4">
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-muted"
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search people, listings, bookings"
            aria-label="Search conversations"
            className="pl-10"
          />
        </div>
        <div role="tablist" aria-label="Conversation folders" className="flex gap-1 text-sm">
          {[
            [false, 'Inbox'],
            [true, 'Archived'],
          ].map(([value, label]) => (
            <button
              key={String(value)}
              type="button"
              role="tab"
              aria-selected={archived === value}
              onClick={() => onArchived(value as boolean)}
              className="rounded-full px-3 py-1.5 font-medium text-text-secondary hover:bg-surface-secondary aria-selected:bg-surface-inverse aria-selected:text-text-inverse"
            >
              {label as string}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <Alert tone="error" className="m-4">
            {error}
          </Alert>
        )}
        {!error && items.length === 0 && !loading && (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-surface-secondary text-text-secondary">
              <MessageSquare aria-hidden className="size-5" />
            </span>
            <p className="mt-4 font-medium text-text">
              {search
                ? 'No conversations match'
                : archived
                  ? 'Nothing archived'
                  : 'No messages yet'}
            </p>
            {!search && !archived && (
              <p className="mt-1 max-w-xs text-sm text-text-secondary">
                Conversations about listings and bookings appear here.
              </p>
            )}
          </div>
        )}
        <ul aria-label="Conversations">
          {items.map((c) => {
            const person = counterpart(c, viewerId);
            const active = c.id === selectedId;
            const preview = c.lastMessage
              ? c.lastMessage.deleted
                ? 'Message deleted'
                : `${c.lastMessage.senderId === viewerId ? 'You: ' : ''}${c.lastMessage.text ?? ''}`
              : 'No messages yet';
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex w-full gap-3 border-b border-border px-4 py-3.5 text-left transition-colors hover:bg-surface-secondary focus-visible:bg-surface-secondary',
                    active && 'bg-surface-secondary',
                  )}
                >
                  <ChatAvatar name={person?.name ?? '?'} url={person?.avatarUrl ?? null} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={cn(
                          'truncate text-sm text-text',
                          c.unreadCount > 0 ? 'font-bold' : 'font-medium',
                        )}
                      >
                        {person?.name ?? 'Conversation'}
                      </span>
                      <span className="shrink-0 text-xs text-text-muted">
                        {formatListTime(c.lastActivityAt)}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-text-muted">{contextLine(c)}</span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          'truncate text-sm',
                          c.unreadCount > 0 ? 'text-text' : 'text-text-secondary',
                          c.lastMessage?.deleted && 'italic',
                        )}
                      >
                        {preview}
                      </span>
                      {c.unreadCount > 0 && (
                        <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">
                          {c.unreadCount > 99 ? '99+' : c.unreadCount}
                          <span className="sr-only"> unread</span>
                        </span>
                      )}
                    </span>
                    {c.status === 'CLOSED' && (
                      <span className="mt-1 block text-xs font-medium text-warning">
                        Closed by support
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {loading && (
          <p
            role="status"
            className="flex items-center justify-center gap-2 p-6 text-sm text-text-secondary"
          >
            <Spinner /> Loading conversations…
          </p>
        )}
        {nextCursor && !loading && (
          <div className="p-4">
            <Button variant="ghost" onClick={onLoadMore} className="w-full">
              Load more
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

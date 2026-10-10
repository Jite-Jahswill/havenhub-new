'use client';

import {
  MESSAGE_REACTIONS,
  REACTION_LABELS,
  type MessageReactionEmoji,
  type MessageView,
} from '@havenhub/shared';
import { cn } from '@havenhub/ui';
import { FileText, Pencil, Reply, SmilePlus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { formatBytes, formatTime } from './chat-utils';
import { ContactWarning } from './contact-warning';

export interface PendingMessage {
  clientKey: string;
  body: string;
  status: 'sending' | 'failed';
  error?: string;
}

/**
 * One message. Text is rendered as text (React escapes it) — never as HTML.
 * Actions appear on hover, on keyboard focus, or when the message is tapped.
 */
export function MessageItem({
  message,
  own,
  showSender,
  readByOther,
  onReply,
  onEdit,
  onDelete,
  onReact,
  onJumpTo,
}: {
  message: MessageView;
  own: boolean;
  showSender: boolean;
  readByOther: boolean;
  onReply: (m: MessageView) => void;
  onEdit: (m: MessageView) => void;
  onDelete: (m: MessageView) => void;
  onReact: (m: MessageView, emoji: MessageReactionEmoji | null) => void;
  onJumpTo: (id: string) => void;
}) {
  const [picker, setPicker] = useState(false);
  /** Tapped on a touch screen: shows this message's actions. */
  const [active, setActive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleted = message.deletedAt !== null;

  if (message.type === 'SYSTEM') {
    return (
      <li id={`m-${message.id}`} className="flex justify-center py-2">
        <p className="rounded-full bg-surface-secondary px-3 py-1 text-center text-xs text-text-secondary">
          {message.body}
        </p>
      </li>
    );
  }

  const mine = message.reactions.find((r) => r.mine)?.emoji as MessageReactionEmoji | undefined;
  const name = message.sender?.name ?? 'HavenHub';

  return (
    <li
      id={`m-${message.id}`}
      className={cn('group flex flex-col gap-1 py-1', own ? 'items-end' : 'items-start')}
    >
      {showSender && !own && (
        <span className="px-3 text-xs font-medium text-text-secondary">{name}</span>
      )}
      <div
        className={cn(
          'flex max-w-[85%] min-w-0 items-end gap-1.5 sm:max-w-[75%]',
          own && 'flex-row-reverse',
        )}
      >
        <div
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('a,button,video,audio')) return;
            setActive((a) => !a);
          }}
          className={cn(
            'min-w-0 rounded-2xl px-3.5 py-2.5 text-sm',
            own
              ? 'rounded-br-md bg-primary-subtle text-text'
              : 'rounded-bl-md bg-surface-secondary text-text',
            deleted && 'bg-transparent text-text-muted italic ring-1 ring-border',
          )}
        >
          <span className="sr-only">{own ? 'You' : name}: </span>
          {deleted ? (
            'This message was deleted.'
          ) : (
            <>
              {message.replyTo && (
                <button
                  type="button"
                  onClick={() => onJumpTo(message.replyTo!.id)}
                  className="mb-2 block w-full rounded-lg border-l-4 border-primary bg-surface/70 px-2.5 py-1.5 text-left text-xs"
                  aria-label={`Replying to ${message.replyTo.senderName ?? 'a message'}: ${message.replyTo.text ?? 'attachment'}. Go to message`}
                >
                  <span className="block font-semibold text-text">
                    {message.replyTo.senderName ?? 'Message'}
                  </span>
                  <span className="line-clamp-2 text-text-secondary">
                    {message.replyTo.deleted
                      ? 'Original message deleted'
                      : (message.replyTo.text ??
                        (message.replyTo.attachmentKind ? 'Attachment' : ''))}
                  </span>
                </button>
              )}
              {message.attachments.length > 0 && <Attachments message={message} />}
              {message.body && <p className="break-words whitespace-pre-wrap">{message.body}</p>}
            </>
          )}
          <span className="mt-1 flex items-center justify-end gap-1.5 text-[11px] text-text-muted">
            {message.editedAt && !deleted && <span>Edited</span>}
            <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
            {own && !deleted && <span>{readByOther ? '· Read' : '· Sent'}</span>}
          </span>
        </div>

        {!deleted && (
          <div
            role="toolbar"
            aria-label="Message actions"
            className={cn(
              'flex shrink-0 gap-0.5 transition-opacity group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100',
              active ? 'opacity-100' : 'opacity-0 [@media(hover:none)]:hidden',
            )}
          >
            <Action label="Reply" onClick={() => onReply(message)}>
              <Reply aria-hidden className="size-4" />
            </Action>
            <Action label="React" onClick={() => setPicker((p) => !p)} pressed={picker}>
              <SmilePlus aria-hidden className="size-4" />
            </Action>
            {message.canEdit && (
              <Action label="Edit" onClick={() => onEdit(message)}>
                <Pencil aria-hidden className="size-4" />
              </Action>
            )}
            {message.canDelete && (
              <Action label="Delete" onClick={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden className="size-4" />
              </Action>
            )}
          </div>
        )}
      </div>
      {!deleted && <ContactWarning text={message.body} className="max-w-[85%] sm:max-w-[75%]" />}

      {picker && (
        <div
          role="group"
          aria-label="Choose a reaction"
          className="flex gap-1 rounded-full border border-border bg-surface p-1 shadow-card"
        >
          {MESSAGE_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={REACTION_LABELS[emoji]}
              aria-pressed={mine === emoji}
              onClick={() => {
                onReact(message, mine === emoji ? null : emoji);
                setPicker(false);
              }}
              className="grid size-9 place-items-center rounded-full text-lg hover:bg-surface-secondary aria-pressed:bg-primary-subtle"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {confirmDelete && (
        <div
          role="alertdialog"
          aria-label="Delete message"
          className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs shadow-card"
        >
          <span className="text-text-secondary">Delete for everyone?</span>
          <button
            type="button"
            autoFocus
            onClick={() => {
              setConfirmDelete(false);
              onDelete(message);
            }}
            className="rounded-full px-2 py-1 font-semibold text-error hover:bg-error-subtle"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            className="rounded-full px-2 py-1 font-medium text-text hover:bg-surface-secondary"
          >
            Cancel
          </button>
        </div>
      )}

      {message.reactions.length > 0 && !deleted && (
        <ul
          className={cn('flex flex-wrap gap-1', own ? 'justify-end' : 'justify-start')}
          aria-label="Reactions"
        >
          {message.reactions.map((r) => (
            <li key={r.emoji}>
              <button
                type="button"
                aria-pressed={r.mine}
                aria-label={`${REACTION_LABELS[r.emoji as MessageReactionEmoji] ?? r.emoji}, ${r.count}${r.mine ? ', including you' : ''}`}
                onClick={() => onReact(message, r.mine ? null : (r.emoji as MessageReactionEmoji))}
                className="flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-text-secondary aria-pressed:border-primary aria-pressed:text-text"
              >
                <span aria-hidden>{r.emoji}</span>
                {r.count}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Action({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-full text-text-muted hover:bg-surface-secondary hover:text-text focus-visible:outline-2 focus-visible:outline-primary"
    >
      {children}
    </button>
  );
}

function Attachments({ message }: { message: MessageView }) {
  return (
    <div className="mb-1.5 flex flex-col gap-2">
      {message.attachments.map((a) => {
        if (a.kind === 'IMAGE') {
          return (
            <a
              key={a.id}
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-lg"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- private, authenticated API URL */}
              <img
                src={a.thumbnailUrl ?? a.url}
                alt={a.fileName}
                width={a.width ?? undefined}
                height={a.height ?? undefined}
                loading="lazy"
                className="h-auto max-h-72 w-full max-w-xs object-cover"
              />
            </a>
          );
        }
        if (a.kind === 'VIDEO') {
          return (
            <video
              key={a.id}
              controls
              preload="metadata"
              src={a.url}
              className="max-h-72 w-full max-w-xs rounded-lg bg-black"
              aria-label={a.fileName}
            />
          );
        }
        if (a.kind === 'AUDIO') {
          return (
            <audio
              key={a.id}
              controls
              preload="metadata"
              src={a.url}
              className="w-64 max-w-full"
              aria-label={a.fileName}
            />
          );
        }
        return (
          <a
            key={a.id}
            href={a.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2 hover:bg-surface-secondary"
          >
            <FileText aria-hidden className="size-5 shrink-0 text-text-secondary" />
            <span className="min-w-0">
              <span className="block truncate font-medium text-text">{a.fileName}</span>
              <span className="block text-xs text-text-muted">{formatBytes(a.bytes)}</span>
            </span>
          </a>
        );
      })}
    </div>
  );
}

/** An optimistic message not yet confirmed by the server. */
export function PendingItem({
  pending,
  onRetry,
}: {
  pending: PendingMessage;
  onRetry: () => void;
}) {
  return (
    <li className="flex flex-col items-end gap-1 py-1">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary-subtle px-3.5 py-2.5 text-sm text-text opacity-80 sm:max-w-[75%]">
        <p className="break-words whitespace-pre-wrap">{pending.body || 'Attachment'}</p>
        <span className="mt-1 block text-right text-[11px] text-text-muted">
          {pending.status === 'sending' ? 'Sending…' : 'Not sent'}
        </span>
      </div>
      {pending.status === 'failed' && (
        <p className="flex items-center gap-2 text-xs text-error" role="alert">
          {pending.error ?? 'Could not send.'}
          <button type="button" onClick={onRetry} className="font-semibold underline">
            Retry
          </button>
        </p>
      )}
    </li>
  );
}

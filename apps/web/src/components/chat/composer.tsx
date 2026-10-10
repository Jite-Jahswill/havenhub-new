'use client';

import {
  ATTACHMENT_LIMITS,
  ChatClientEvent,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_MESSAGE_LENGTH,
  type MessageAttachmentView,
  type MessageView,
} from '@havenhub/shared';
import { Button, cn } from '@havenhub/ui';
import { FileText, Paperclip, Pencil, Reply, SendHorizontal, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import { apiUploadWithProgress } from '@/lib/api/client';
import { realtime } from '@/lib/realtime';
import { formatBytes } from './chat-utils';
import { ContactWarning } from './contact-warning';

interface Upload {
  key: string;
  name: string;
  size: number;
  progress: number;
  attachment: MessageAttachmentView | null;
  error: string | null;
}

const ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/webm,application/pdf,.docx,.xlsx,.pptx,.txt,.csv';

export function Composer({
  conversationId,
  disabled,
  replyTo,
  editing,
  onCancelReply,
  onCancelEdit,
  onSend,
  onSaveEdit,
}: {
  conversationId: string;
  disabled: boolean;
  replyTo: MessageView | null;
  editing: MessageView | null;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onSend: (body: string, attachmentIds: string[]) => void;
  onSaveEdit: (message: MessageView, body: string) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const typingAt = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintId = useId();

  // Entering edit mode loads the message text (state adjusted during render,
  // not in an effect); focusing is a side effect.
  const [editingId, setEditingId] = useState<string | null>(null);
  if ((editing?.id ?? null) !== editingId) {
    setEditingId(editing?.id ?? null);
    if (editing) setText(editing.body ?? '');
  }
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  useEffect(() => {
    if (replyTo) input.current?.focus();
  }, [replyTo]);

  const stopTyping = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (typingAt.current) realtime.emit(ChatClientEvent.TYPING_STOP, { conversationId });
    typingAt.current = 0;
  };

  function onChange(value: string) {
    setText(value);
    if (editing) return;
    if (Date.now() - typingAt.current > 2500) {
      realtime.emit(ChatClientEvent.TYPING_START, { conversationId });
      typingAt.current = Date.now();
    }
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(stopTyping, 3000);
  }

  async function pick(list: FileList | null) {
    if (!list) return;
    const room = MAX_ATTACHMENTS_PER_MESSAGE - uploads.length;
    for (const file of Array.from(list).slice(0, Math.max(room, 0))) {
      const key = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
      const tooBig =
        file.size > Math.max(...Object.values(ATTACHMENT_LIMITS).map((l) => l.maxBytes));
      setUploads((u) => [
        ...u,
        {
          key,
          name: file.name,
          size: file.size,
          progress: 0,
          attachment: null,
          error: tooBig ? 'That file is too large.' : null,
        },
      ]);
      if (tooBig) continue;
      const res = await apiUploadWithProgress<MessageAttachmentView>(
        `/conversations/${conversationId}/attachments`,
        file,
        (p) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress: p } : x))),
      );
      setUploads((u) =>
        u.map((x) =>
          x.key === key
            ? res.success
              ? { ...x, progress: 1, attachment: res.data }
              : { ...x, error: res.message }
            : x,
        ),
      );
    }
    if (files.current) files.current.value = '';
  }

  const ready = uploads.filter((u) => u.attachment).map((u) => u.attachment!.id);
  const busy = uploads.some((u) => !u.attachment && !u.error);
  const canSend = !disabled && !busy && (text.trim().length > 0 || ready.length > 0);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (editing) {
      if (!text.trim()) return;
      setSaving(true);
      const ok = await onSaveEdit(editing, text);
      setSaving(false);
      if (ok) setText('');
      return;
    }
    if (!canSend) return;
    stopTyping();
    onSend(text, ready);
    setText('');
    setUploads([]);
    input.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
    if (e.key === 'Escape') {
      if (editing) {
        onCancelEdit();
        setText('');
      } else if (replyTo) onCancelReply();
    }
  }

  return (
    <form onSubmit={submit} className="border-t border-border bg-surface p-3 sm:p-4">
      {(replyTo || editing) && (
        <div className="mb-2 flex items-start justify-between gap-3 rounded-lg bg-surface-secondary px-3 py-2 text-sm">
          <span className="flex min-w-0 gap-2">
            {editing ? (
              <Pencil aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
            ) : (
              <Reply aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
            )}
            <span className="min-w-0">
              <span className="block font-semibold text-text">
                {editing ? 'Editing message' : `Replying to ${replyTo?.sender?.name ?? 'message'}`}
              </span>
              {replyTo && (
                <span className="line-clamp-1 text-text-secondary">
                  {replyTo.body ?? 'Attachment'}
                </span>
              )}
            </span>
          </span>
          <button
            type="button"
            aria-label={editing ? 'Cancel editing' : 'Cancel reply'}
            onClick={() => {
              if (editing) {
                onCancelEdit();
                setText('');
              } else onCancelReply();
            }}
            className="grid size-7 shrink-0 place-items-center rounded-full hover:bg-surface"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      )}

      <ContactWarning text={text} className="mb-2" />

      {uploads.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Attachments to send">
          {uploads.map((u) => (
            <li
              key={u.key}
              className={cn(
                'flex w-56 max-w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-xs',
                u.error ? 'border-error/40' : 'border-border',
              )}
            >
              <FileText aria-hidden className="size-4 shrink-0 text-text-secondary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-text">{u.name}</span>
                {u.error ? (
                  <span className="block text-error" role="alert">
                    {u.error}
                  </span>
                ) : u.attachment ? (
                  <span className="block text-text-muted">{formatBytes(u.size)} · Ready</span>
                ) : (
                  <span
                    className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-secondary"
                    role="progressbar"
                    aria-label={`Uploading ${u.name}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(u.progress * 100)}
                  >
                    <span
                      className="block h-full bg-primary"
                      style={{ width: `${Math.round(u.progress * 100)}%` }}
                    />
                  </span>
                )}
              </span>
              <button
                type="button"
                aria-label={`Remove ${u.name}`}
                onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))}
                className="grid size-6 shrink-0 place-items-center rounded-full hover:bg-surface-secondary"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        {!editing && (
          <>
            <button
              type="button"
              onClick={() => files.current?.click()}
              disabled={disabled || uploads.length >= MAX_ATTACHMENTS_PER_MESSAGE}
              aria-label="Attach files"
              title="Attach files"
              className="grid size-11 shrink-0 place-items-center rounded-full text-text-secondary hover:bg-surface-secondary hover:text-text disabled:opacity-50"
            >
              <Paperclip aria-hidden className="size-5" />
            </button>
            <input
              ref={files}
              type="file"
              multiple
              accept={ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => void pick(e.target.files)}
            />
          </>
        )}
        <label className="sr-only" htmlFor={`${hintId}-input`}>
          {editing ? 'Edit your message' : 'Write a message'}
        </label>
        <textarea
          ref={input}
          id={`${hintId}-input`}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={stopTyping}
          disabled={disabled}
          rows={1}
          maxLength={MAX_MESSAGE_LENGTH}
          aria-describedby={hintId}
          placeholder={disabled ? 'This conversation is closed' : 'Write a message…'}
          className="field-sizing-content max-h-40 min-h-11 flex-1 resize-none rounded-control border border-border-strong bg-surface px-4 py-2.5 text-sm text-text placeholder:text-text-muted focus:border-primary focus:outline-none disabled:opacity-60"
        />
        <Button
          type="submit"
          aria-label={editing ? 'Save edit' : 'Send message'}
          disabled={editing ? saving || !text.trim() : !canSend}
          loading={saving}
          className="size-11 shrink-0 rounded-full p-0"
        >
          {!saving && <SendHorizontal aria-hidden className="size-5" />}
        </Button>
      </div>
      <p id={hintId} className="sr-only">
        Press Enter to send and Shift+Enter for a new line.
      </p>
    </form>
  );
}

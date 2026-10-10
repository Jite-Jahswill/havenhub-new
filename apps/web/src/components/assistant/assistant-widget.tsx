'use client';

import type { AssistantHandoffResult, AssistantReply } from '@havenhub/shared';
import { Button, cn } from '@havenhub/ui';
import { Bot, Headset, LogIn, MessageCircle, Send, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { api } from '@/lib/api/client';

type NewEntry = { from: 'user'; text: string } | { from: 'assistant'; reply: AssistantReply };
type Entry = NewEntry & { id: number };

const STORAGE_KEY = 'havenhub.assistant';
/** Where the floating button would cover a chat composer. */
const HIDDEN_ON = [/^\/(account|agent)\/messages/];

function restore(): Entry[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as {
      entries?: Entry[];
    } | null;
    return Array.isArray(saved?.entries) ? saved.entries : [];
  } catch {
    return [];
  }
}

/**
 * "Ask HavenHub": a floating assistant that answers from HavenHub's own data
 * (no external AI) and can pass the visitor to the support team. The
 * conversation lasts for the browser tab (session storage).
 */
export function AssistantWidget({
  greeting,
  handoffEnabled,
  viewer,
}: {
  greeting: string;
  handoffEnabled: boolean;
  viewer: 'customer' | 'agent' | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // Restored on first open (session storage is browser-only).
  if (open && entries === null) setEntries(restore());
  const items = entries ?? [];

  useEffect(() => {
    if (entries === null) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ entries: entries.slice(-30) }));
    } catch {
      /* storage unavailable: the conversation just isn't kept */
    }
    list.current?.lastElementChild?.scrollIntoView({ block: 'end' });
  }, [entries]);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  if (HIDDEN_ON.some((re) => re.test(pathname))) return null;

  const add = (entry: NewEntry) =>
    setEntries((prev) => {
      const list = prev ?? [];
      return [...list, { ...entry, id: (list.at(-1)?.id ?? 0) + 1 }];
    });

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setError(null);
    setText('');
    add({ from: 'user', text: q });
    setBusy(true);
    const res = await api<AssistantReply>('POST', '/assistant/ask', { text: q });
    setBusy(false);
    if (res.success) add({ from: 'assistant', reply: res.data });
    else setError(res.message);
  }

  async function handoff() {
    const lastQuestion = [...items].reverse().find((e) => e.from === 'user');
    setBusy(true);
    setError(null);
    const res = await api<AssistantHandoffResult>('POST', '/assistant/handoff', {
      ...(lastQuestion?.from === 'user' ? { question: lastQuestion.text.slice(0, 500) } : {}),
      transcript: items
        .slice(-10)
        .map((e) =>
          e.from === 'user'
            ? { from: 'user', text: e.text.slice(0, 1000) }
            : { from: 'assistant', text: e.reply.text.slice(0, 1000) },
        ),
    });
    setBusy(false);
    if (!res.success) {
      setError(res.message);
      return;
    }
    setOpen(false);
    router.push(
      `/${viewer === 'agent' ? 'agent' : 'account'}/messages?c=${res.data.conversationId}`,
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(text);
  }

  const signInHref = `/login?next=${encodeURIComponent(pathname)}`;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        aria-controls={panelId}
        className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-raised hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:right-6 sm:bottom-6"
      >
        <MessageCircle aria-hidden className="size-5" />
        Ask HavenHub
      </button>
    );
  }

  return (
    <section
      id={panelId}
      role="dialog"
      aria-label="HavenHub assistant"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
      }}
      className="fixed inset-x-2 bottom-2 z-40 flex h-[min(80dvh,600px)] flex-col overflow-hidden rounded-card border border-border bg-surface text-text shadow-raised sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[400px]"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <p className="flex items-center gap-2 font-semibold">
          <Bot aria-hidden className="size-5 text-primary" /> HavenHub assistant
        </p>
        <button
          type="button"
          aria-label="Close the assistant"
          onClick={() => setOpen(false)}
          className="grid size-8 place-items-center rounded-full hover:bg-surface-secondary"
        >
          <X aria-hidden className="size-5" />
        </button>
      </header>

      <ol
        ref={list}
        aria-live="polite"
        className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 text-sm"
      >
        <li className="max-w-[90%] rounded-2xl rounded-bl-md bg-surface-secondary px-3.5 py-2.5 whitespace-pre-line">
          {greeting}
        </li>
        {items.map((e) =>
          e.from === 'user' ? (
            <li
              key={e.id}
              className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-primary-subtle px-3.5 py-2.5 break-words"
            >
              <span className="sr-only">You: </span>
              {e.text}
            </li>
          ) : (
            <li key={e.id} className="flex max-w-[95%] flex-col gap-2">
              <p className="rounded-2xl rounded-bl-md bg-surface-secondary px-3.5 py-2.5 whitespace-pre-line">
                <span className="sr-only">Assistant: </span>
                {e.reply.text}
              </p>
              {e.reply.cards.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {e.reply.cards.map((c) => (
                    <li key={c.href + c.title}>
                      <Link
                        href={c.href}
                        className="flex items-center gap-3 rounded-lg border border-border p-2 hover:bg-surface-secondary"
                      >
                        {c.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element -- small thumbnails from our own storage
                          <img
                            src={c.imageUrl}
                            alt=""
                            className="size-12 shrink-0 rounded-md object-cover"
                          />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{c.title}</span>
                          {c.subtitle && (
                            <span className="block truncate text-xs text-text-secondary">
                              {c.subtitle}
                            </span>
                          )}
                          {c.badge && (
                            <span className="mt-0.5 block text-xs font-semibold text-primary-text">
                              {c.badge}
                            </span>
                          )}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {e.reply.link && (
                <Link
                  href={e.reply.link.href}
                  className="text-sm font-medium text-primary-text underline"
                >
                  {e.reply.link.label}
                </Link>
              )}
              {e.reply.needsSignIn && !viewer && (
                <Link
                  href={signInHref}
                  className="flex items-center gap-1.5 text-sm font-medium text-primary-text underline"
                >
                  <LogIn aria-hidden className="size-4" /> Sign in
                </Link>
              )}
              {e.reply.offerHandoff && handoffEnabled && viewer && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="self-start"
                  loading={busy}
                  onClick={() => void handoff()}
                >
                  <Headset aria-hidden className="size-4" /> Talk to a person
                </Button>
              )}
              {e.reply.offerHandoff && handoffEnabled && !viewer && !e.reply.needsSignIn && (
                <Link href={signInHref} className="text-xs text-text-secondary underline">
                  Sign in to talk to a person
                </Link>
              )}
              {e.reply.suggestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {e.reply.suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void ask(s)}
                      className="rounded-full border border-border px-3 py-1 text-xs hover:bg-surface-secondary"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ),
        )}
        {busy && <li className="self-start text-xs text-text-muted">Thinking…</li>}
      </ol>

      {error && (
        <p role="alert" className="px-4 pb-2 text-xs text-error">
          {error}
        </p>
      )}
      <form onSubmit={submit} className="flex items-center gap-2 border-t border-border p-3">
        <label htmlFor={`${panelId}-q`} className="sr-only">
          Ask a question
        </label>
        <input
          id={`${panelId}-q`}
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          autoComplete="off"
          placeholder="e.g. 2 bedroom flat in Lekki under 3m"
          className="min-w-0 flex-1 rounded-full border border-border bg-surface px-4 py-2 text-sm outline-none focus:border-primary"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={busy || !text.trim()}
          className={cn(
            'grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground',
            (busy || !text.trim()) && 'opacity-50',
          )}
        >
          <Send aria-hidden className="size-4" />
        </button>
      </form>
    </section>
  );
}

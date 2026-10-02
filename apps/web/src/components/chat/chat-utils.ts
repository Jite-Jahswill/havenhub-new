import type { ChatParticipantView, ConversationSummary } from '@havenhub/shared';

const TIME = new Intl.DateTimeFormat('en-NG', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Africa/Lagos',
});
const DAY = new Intl.DateTimeFormat('en-NG', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'Africa/Lagos',
});
const DATE = new Intl.DateTimeFormat('en-NG', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Africa/Lagos',
});
const dayKey = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(d);

export const formatTime = (iso: string) => TIME.format(new Date(iso));

/** "14:05" today, "Mon 3 Oct" this year, "3 Oct 2025" otherwise. */
export function formatListTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (dayKey(d) === dayKey(now)) return TIME.format(d);
  return d.getFullYear() === now.getFullYear() ? DAY.format(d) : DATE.format(d);
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  const key = dayKey(d);
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  return DATE.format(d);
}

export const sameDay = (a: string, b: string) => dayKey(new Date(a)) === dayKey(new Date(b));

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The person you are talking to (the first participant who isn't you). */
export const counterpart = (
  c: ConversationSummary,
  viewerId: string,
): ChatParticipantView | undefined => c.participants.find((p) => p.id !== viewerId);

export function contextLine(c: Pick<ConversationSummary, 'context'>): string {
  switch (c.context.type) {
    case 'BOOKING':
      return `Booking ${c.context.booking.reference} · ${c.context.booking.propertyTitle}`;
    case 'EXPERIENCE':
      return c.context.experience.title;
    case 'PROPERTY':
      return c.context.property.title;
  }
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';

export const newClientKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

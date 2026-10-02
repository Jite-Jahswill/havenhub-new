import type { AdminConversationDetail } from '@havenhub/shared';
import { Alert, Badge, Card, CardBody, CardHeader } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ConversationModeration, RemoveMessage } from '@/components/admin/chat/moderation-actions';
import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { formatMoment } from '@/lib/format';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Conversation' };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function AdminConversationPage({
  params,
  searchParams,
}: PageProps<'/admin/conversations/[id]'>) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser('ADMIN', `/admin/conversations/${id}`);
  if (!UUID.test(id)) notFound();
  if (!hasPermission(user, 'conversations.view')) return <NoAccess />;
  const before =
    typeof sp.before === 'string' && /^\d+$/.test(sp.before) ? `?before=${sp.before}` : '';
  const res = await serverApi<AdminConversationDetail>(`/admin/conversations/${id}${before}`);
  if (!res.success) {
    if (res.code === 'NOT_FOUND') notFound();
    return <Alert tone="error">{res.message}</Alert>;
  }
  const c = res.data;
  const canModerate = hasPermission(user, 'messages.moderate');
  const oldest = c.messages[0]?.seq;

  return (
    <>
      <Link href="/admin/conversations" className="text-sm text-text-secondary hover:text-text">
        ← Conversations
      </Link>
      <div className="mt-4">
        <PageHeader
          title={c.participants.map((p) => p.name).join(' · ')}
          description={
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={c.status === 'CLOSED' ? 'warning' : 'success'}>
                {c.status === 'CLOSED' ? 'Closed' : 'Open'}
              </Badge>
              {c.context.type === 'BOOKING'
                ? `Booking ${c.context.booking.reference}`
                : c.context.property.title}
            </span>
          }
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-labelledby="messages-heading" className="min-w-0">
          <h2 id="messages-heading" className="sr-only">
            Messages
          </h2>
          {c.hasMore && oldest && (
            <Link
              href={`/admin/conversations/${id}?before=${oldest}`}
              className="mb-4 inline-block text-sm font-medium underline"
            >
              Earlier messages
            </Link>
          )}
          <ol className="flex flex-col gap-3">
            {c.messages.length === 0 && (
              <li className="text-sm text-text-secondary">No messages yet.</li>
            )}
            {c.messages.map((m) => (
              <li key={m.id} className="rounded-card border border-border bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-text-muted">
                  <span className="font-semibold text-text">{m.sender?.name ?? 'System'}</span>
                  <span>
                    #{m.seq} · {formatMoment(m.createdAt)}
                    {m.editedAt && ' · edited'}
                  </span>
                </div>
                {m.deletedAt && (
                  <p className="mt-2 text-xs font-medium text-warning">
                    Removed {formatMoment(m.deletedAt)}
                    {m.deletedBy ? ` by ${m.deletedBy.name}` : ''} — participants no longer see
                    this.
                  </p>
                )}
                {m.originalBody && (
                  <p className="mt-2 text-sm break-words whitespace-pre-wrap text-text">
                    {m.originalBody}
                  </p>
                )}
                {m.attachments.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                    {m.attachments.map((a) => (
                      <li key={a.id}>
                        <a href={a.url} target="_blank" rel="noreferrer" className="underline">
                          {a.fileName}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {m.revisions.length > 0 && (
                  <details className="mt-2 text-xs text-text-secondary">
                    <summary className="cursor-pointer">
                      Earlier versions ({m.revisions.length})
                    </summary>
                    <ul className="mt-1 flex flex-col gap-1">
                      {m.revisions.map((r) => (
                        <li key={r.createdAt} className="break-words whitespace-pre-wrap">
                          {formatMoment(r.createdAt)}: {r.body}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {canModerate && !m.deletedAt && m.type !== 'SYSTEM' && (
                  <RemoveMessage messageId={m.id} />
                )}
              </li>
            ))}
          </ol>
        </section>
        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Participants" />
            <CardBody>
              <ul className="flex flex-col gap-2 text-sm">
                {c.participants.map((p) => (
                  <li key={p.id}>
                    <span className="font-medium text-text">{p.name}</span>{' '}
                    <span className="text-text-muted">({p.role.toLowerCase()})</span>
                    <span className="block text-xs text-text-muted">{p.email}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Moderation" description="Actions need a reason and are audited." />
            <CardBody>
              {canModerate ? (
                <ConversationModeration conversationId={c.id} status={c.status} />
              ) : (
                <p className="text-sm text-text-secondary">
                  Moderation requires the “messages.moderate” permission.
                </p>
              )}
              {c.closedReason && (
                <p className="mt-3 text-xs text-text-muted">Closed: {c.closedReason}</p>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}

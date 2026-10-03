import type { AdminSubscriberDetail } from '@havenhub/shared';
import { Badge, Card, CardBody, CardHeader } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AdminUnsubscribe } from '@/components/admin/cms/campaign-editor';
import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { formatMoment } from '@/lib/format';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Subscriber' };
const EVENT: Record<string, string> = {
  REQUESTED: 'Signed up',
  CONFIRMED: 'Confirmed by email',
  UNSUBSCRIBED: 'Unsubscribed',
  ERASED: 'Personal data erased (retention period)',
};

/** The consent record: what was agreed to, when, and every change since. */
export default async function SubscriberPage({
  params,
}: PageProps<'/admin/email-marketing/subscribers/[id]'>) {
  await requireUser('ADMIN', '/admin/email-marketing');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await serverApi<AdminSubscriberDetail>(`/admin/newsletter/subscribers/${id}`);
  if (!res.success) {
    if (res.code === 'NOT_FOUND') notFound();
    return <NoAccess />;
  }
  const s = res.data;
  return (
    <>
      <Link
        href="/admin/email-marketing?tab=subscribers"
        className="text-sm text-text-secondary hover:text-text"
      >
        ← Subscribers
      </Link>
      <div className="mt-4">
        <PageHeader
          title={s.email}
          action={
            <Badge tone={s.status === 'SUBSCRIBED' ? 'success' : 'neutral'}>
              {s.status.toLowerCase()}
            </Badge>
          }
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader title="Consent history" />
          <CardBody>
            <ol className="flex flex-col gap-4">
              {s.history.map((h, i) => (
                <li key={i} className="border-l-2 border-border pl-4 text-sm">
                  <p className="font-medium text-text">{EVENT[h.type] ?? h.type}</p>
                  <p className="text-text-muted">
                    {formatMoment(h.at)}
                    {h.source ? ` · ${h.source.replace(/_/g, ' ')}` : ''}
                  </p>
                  {h.consentText && (
                    <blockquote className="mt-1 text-text-secondary">“{h.consentText}”</blockquote>
                  )}
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex flex-col gap-3 text-sm">
            <p className="text-text-secondary">
              Subscribed {s.confirmedAt ? formatMoment(s.confirmedAt) : '—'}
            </p>
            {s.status !== 'UNSUBSCRIBED' ? (
              <AdminUnsubscribe id={s.id} />
            ) : (
              <p className="text-text-secondary">
                Unsubscribed {s.unsubscribedAt ? formatMoment(s.unsubscribedAt) : ''}
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

'use client';

import {
  CMS_LIMITS,
  type AdminCampaignView,
  type ApiError,
  type ApiResponse,
  type CampaignStatus,
} from '@havenhub/shared';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api/client';
import { fieldErrors as toFieldErrors } from '@/lib/api/errors';
import { formatMoment } from '@/lib/format';

import { MarkdownEditor } from './markdown-editor';

const TONE: Record<CampaignStatus, 'neutral' | 'warning' | 'success' | 'error'> = {
  DRAFT: 'neutral',
  SCHEDULED: 'warning',
  SENDING: 'warning',
  SENT: 'success',
  CANCELLED: 'error',
};
export const CAMPAIGN_LABEL: Record<CampaignStatus, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  SENDING: 'Sending',
  SENT: 'Sent',
  CANCELLED: 'Cancelled',
};
export const CampaignBadge = ({ status }: { status: CampaignStatus }) => (
  <Badge tone={TONE[status]}>{CAMPAIGN_LABEL[status]}</Badge>
);

const fromLagos = (v: string) => (v ? `${v}:00+01:00` : undefined);

/**
 * A campaign to every subscriber with confirmed consent. Each email carries
 * an unsubscribe link; no opens or clicks are tracked.
 */
export function CampaignEditor({
  campaign,
  mediaBase,
  canSend,
  canUpload,
}: {
  campaign: AdminCampaignView | null;
  mediaBase: string;
  canSend: boolean;
  canUpload: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(campaign?.name ?? '');
  const [subject, setSubject] = useState(campaign?.subject ?? '');
  const [body, setBody] = useState(campaign?.body ?? '');
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const errors = toFieldErrors(error);
  const draft = !campaign || campaign.status === 'DRAFT';
  const dirty =
    campaign && (name !== campaign.name || subject !== campaign.subject || body !== campaign.body);

  async function call(
    key: string,
    fn: () => Promise<ApiResponse<AdminCampaignView>>,
    done: string,
  ) {
    setBusy(key);
    setError(null);
    setNotice(null);
    const res = await fn();
    setBusy(null);
    if (!res.success) return setError(res);
    if (!campaign) return router.push(`/admin/email-marketing/campaigns/${res.data.id}`);
    setNotice(done);
    router.refresh();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardBody className="flex flex-col gap-5">
          <fieldset disabled={!draft} className="contents">
            <Field label="Internal name" error={errors.name}>
              {(a) => (
                <Input
                  {...a}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                />
              )}
            </Field>
            <Field label="Email subject" error={errors.subject}>
              {(a) => (
                <Input
                  {...a}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={160}
                />
              )}
            </Field>
            <MarkdownEditor
              label="Email"
              name="body"
              value={body}
              onChange={setBody}
              mediaBase={mediaBase}
              maxLength={CMS_LIMITS.campaignBody}
              rows={16}
              error={errors.body}
              canUpload={canUpload}
              disabled={!draft}
              hint="An unsubscribe link is added to every email automatically."
            />
          </fieldset>
        </CardBody>
      </Card>
      <aside className="flex flex-col gap-4 xl:sticky xl:top-26 xl:self-start">
        <Card>
          <CardBody className="flex flex-col gap-3">
            {campaign && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-text">Status</span>
                <CampaignBadge status={campaign.status} />
              </div>
            )}
            {campaign?.scheduledAt && campaign.status === 'SCHEDULED' && (
              <p className="text-sm text-text-secondary">
                Sends {formatMoment(campaign.scheduledAt)}
              </p>
            )}
            {campaign && (
              <p className="text-sm text-text-secondary">
                {campaign.eligibleRecipients} subscriber
                {campaign.eligibleRecipients === 1 ? '' : 's'} with confirmed consent
              </p>
            )}
            {error && error.code !== 'VALIDATION_ERROR' && (
              <Alert tone="error">{error.message}</Alert>
            )}
            {error?.code === 'VALIDATION_ERROR' && (
              <Alert tone="error">{errors.body ?? 'Please fix the highlighted fields.'}</Alert>
            )}
            {notice && <Alert tone="success">{notice}</Alert>}
            {draft && (
              <Button
                loading={busy === 'save'}
                onClick={() =>
                  void call(
                    'save',
                    () =>
                      campaign
                        ? api<AdminCampaignView>(
                            'PATCH',
                            `/admin/newsletter/campaigns/${campaign.id}`,
                            { name, subject, body },
                          )
                        : api<AdminCampaignView>('POST', '/admin/newsletter/campaigns', {
                            name,
                            subject,
                            body,
                          }),
                    'Saved.',
                  )
                }
              >
                {campaign ? 'Save draft' : 'Create draft'}
              </Button>
            )}
            {campaign?.status === 'DRAFT' && canSend && (
              <>
                <Button
                  variant="secondary"
                  disabled={Boolean(dirty) || campaign.eligibleRecipients === 0}
                  loading={busy === 'send'}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Send “${campaign.subject}” to ${campaign.eligibleRecipients} subscribers now?`,
                      )
                    )
                      return;
                    void call(
                      'send',
                      () =>
                        api<AdminCampaignView>(
                          'POST',
                          `/admin/newsletter/campaigns/${campaign.id}/schedule`,
                          {},
                        ),
                      'Queued for sending.',
                    );
                  }}
                >
                  Send now
                </Button>
                <div className="flex flex-col gap-2 rounded-control border border-border p-3">
                  <Field label="Or schedule for (Lagos time)">
                    {(a) => (
                      <Input
                        {...a}
                        type="datetime-local"
                        value={when}
                        onChange={(e) => setWhen(e.target.value)}
                      />
                    )}
                  </Field>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!when || Boolean(dirty)}
                    loading={busy === 'schedule'}
                    onClick={() =>
                      void call(
                        'schedule',
                        () =>
                          api<AdminCampaignView>(
                            'POST',
                            `/admin/newsletter/campaigns/${campaign.id}/schedule`,
                            { scheduledAt: fromLagos(when) },
                          ),
                        'Scheduled.',
                      )
                    }
                  >
                    Schedule
                  </Button>
                </div>
                {dirty && <p className="text-xs text-text-muted">Save the draft before sending.</p>}
              </>
            )}
            {campaign &&
              (campaign.status === 'SCHEDULED' || campaign.status === 'SENDING') &&
              canSend && (
                <Button
                  variant="danger"
                  loading={busy === 'cancel'}
                  onClick={() => {
                    if (
                      window.confirm(
                        campaign.status === 'SENDING'
                          ? 'Stop sending? Emails already delivered cannot be recalled.'
                          : 'Cancel the schedule and return to draft?',
                      )
                    )
                      void call(
                        'cancel',
                        () =>
                          api<AdminCampaignView>(
                            'POST',
                            `/admin/newsletter/campaigns/${campaign.id}/cancel`,
                          ),
                        'Cancelled.',
                      );
                  }}
                >
                  {campaign.status === 'SENDING' ? 'Stop sending' : 'Cancel schedule'}
                </Button>
              )}
            {campaign?.status === 'DRAFT' && (
              <Button
                variant="ghost"
                loading={busy === 'delete'}
                onClick={async () => {
                  if (!window.confirm('Delete this draft?')) return;
                  setBusy('delete');
                  const res = await api('DELETE', `/admin/newsletter/campaigns/${campaign.id}`);
                  setBusy(null);
                  if (res.success) router.push('/admin/email-marketing');
                  else setError(res);
                }}
              >
                Delete draft
              </Button>
            )}
          </CardBody>
        </Card>
        {campaign && campaign.stats.total > 0 && (
          <Card>
            <CardHeader title="Delivery" />
            <CardBody>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {(
                  [
                    ['Sent', campaign.stats.sent],
                    ['Waiting', campaign.stats.pending],
                    ['Failed', campaign.stats.failed],
                    ['Skipped (unsubscribed)', campaign.stats.skipped],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-text-muted">{label}</dt>
                    <dd className="text-lg font-semibold text-text tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
        )}
      </aside>
    </div>
  );
}

/** Records an opt-out received another way (email, phone). */
export function AdminUnsubscribe({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="danger"
      loading={busy}
      onClick={async () => {
        if (!window.confirm('Unsubscribe this address? They will not receive further campaigns.'))
          return;
        setBusy(true);
        await api('POST', `/admin/newsletter/subscribers/${id}/unsubscribe`);
        setBusy(false);
        router.refresh();
      }}
    >
      Unsubscribe
    </Button>
  );
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  markdownToEmailHtml,
  markdownToText,
  parseMarkdown,
  type AdminCampaignView,
  type CampaignStats,
  type Paginated,
  type adminCampaignListQuerySchema,
  type createCampaignSchema,
  type updateCampaignSchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { paginate } from '../../common/http/response';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { EmailCampaign, Prisma } from '../../generated/prisma/client';
import { MailTemplates } from '../../infrastructure/mail/mail.templates';
import { MAIL_TRANSPORT, type MailTransport } from '../../infrastructure/mail/mail.types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { describeError } from '../../common/logging/describe-error';
import { AuditService } from '../audit/audit.service';
import {
  assertMarkdownImages,
  conflict,
  invalidTransition,
  iso,
  mediaBase,
  validationError,
} from './cms-helpers';
import { NewsletterService } from './newsletter.service';

type Out<T extends z.ZodType> = z.output<T>;
type Tx = Prisma.TransactionClient;

/** A delivery claimed this long ago without a result is treated as failed (never resent). */
const STALE_CLAIM_MS = 15 * 60_000;

/**
 * Email campaigns to every subscriber with confirmed consent. No
 * segmentation, open or click tracking (Phase 7 decision); delivery status
 * is recorded per recipient.
 *
 * Duplicate sends cannot happen: each (campaign, subscriber) pair is a
 * unique row; rows are claimed with SKIP LOCKED before sending; a claimed
 * row is never sent again (at-most-once — a crash mid-send marks it failed
 * rather than risking a second email; failed deliveries are final, there is
 * no retry in this phase); and the sender runs under a
 * distributed lock. Consent is re-checked immediately before every send, so
 * unsubscribing stops delivery even mid-campaign.
 */
@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly newsletter: NewsletterService,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list(
    query: Out<typeof adminCampaignListQuerySchema>,
  ): Promise<Paginated<AdminCampaignView>> {
    const where: Prisma.EmailCampaignWhereInput = query.status ? { status: query.status } : {};
    const [total, rows, eligible] = await Promise.all([
      this.prisma.emailCampaign.count({ where }),
      this.prisma.emailCampaign.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.eligible(),
    ]);
    const stats = await this.stats(rows.map((r) => r.id));
    return paginate(
      rows.map((r) => view(r, stats.get(r.id), eligible)),
      query.page,
      query.pageSize,
      total,
    );
  }

  async get(id: string): Promise<AdminCampaignView> {
    const row = await this.prisma.emailCampaign.findUnique({ where: { id } });
    if (!row) throw Errors.notFound('Campaign');
    const [stats, eligible] = await Promise.all([this.stats([id]), this.eligible()]);
    return view(row, stats.get(id), eligible);
  }

  async create(actorId: string, input: Out<typeof createCampaignSchema>, meta: RequestMeta) {
    const row = await this.prisma.$transaction(async (tx) => {
      await assertMarkdownImages(tx, this.storage, input.body, 'body');
      const created = await tx.emailCampaign.create({ data: { ...input, createdById: actorId } });
      await this.audit.record(
        {
          actorId,
          action: 'newsletter.campaign_created',
          resourceType: 'email_campaign',
          resourceId: created.id,
          meta,
        },
        tx,
      );
      return created;
    });
    return this.get(row.id);
  }

  async update(
    actorId: string,
    id: string,
    input: Out<typeof updateCampaignSchema>,
    meta: RequestMeta,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.locked(tx, id);
      if (current.status !== 'DRAFT')
        throw invalidTransition('Only draft campaigns can be edited.');
      await assertMarkdownImages(tx, this.storage, input.body, 'body');
      await tx.emailCampaign.update({ where: { id }, data: input });
      await this.audit.record(
        {
          actorId,
          action: 'newsletter.campaign_updated',
          resourceType: 'email_campaign',
          resourceId: id,
          after: { fields: Object.keys(input) },
          meta,
        },
        tx,
      );
    });
    return this.get(id);
  }

  /** Queue for sending now, or at `scheduledAt`. */
  async schedule(actorId: string, id: string, scheduledAt: string | undefined, meta: RequestMeta) {
    const at = scheduledAt ? new Date(scheduledAt) : new Date();
    await this.prisma.$transaction(async (tx) => {
      const current = await this.locked(tx, id);
      if (current.status !== 'DRAFT')
        throw invalidTransition('Only draft campaigns can be scheduled.');
      if (!current.body.trim()) throw validationError('body', 'Write the email first');
      await tx.emailCampaign.update({
        where: { id },
        data: { status: 'SCHEDULED', scheduledAt: at },
      });
      await this.audit.record(
        {
          actorId,
          action: 'newsletter.campaign_scheduled',
          resourceType: 'email_campaign',
          resourceId: id,
          after: { scheduledAt: at.toISOString() },
          meta,
        },
        tx,
      );
    });
    return this.get(id);
  }

  /**
   * Scheduled → back to draft. Sending → cancelled: nothing more is sent;
   * emails already delivered cannot be recalled.
   */
  async cancel(actorId: string, id: string, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.locked(tx, id);
      if (current.status === 'SCHEDULED') {
        await tx.emailCampaign.update({
          where: { id },
          data: { status: 'DRAFT', scheduledAt: null },
        });
      } else if (current.status === 'SENDING') {
        await tx.emailCampaign.update({
          where: { id },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
        });
        await tx.emailCampaignDelivery.updateMany({
          where: { campaignId: id, status: 'PENDING' },
          data: { status: 'SKIPPED', error: 'Campaign cancelled' },
        });
      } else {
        throw invalidTransition('Only scheduled or sending campaigns can be cancelled.');
      }
      await this.audit.record(
        {
          actorId,
          action: 'newsletter.campaign_cancelled',
          resourceType: 'email_campaign',
          resourceId: id,
          before: { status: current.status },
          meta,
        },
        tx,
      );
    });
    return this.get(id);
  }

  async remove(actorId: string, id: string, meta: RequestMeta): Promise<{ deleted: true }> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.locked(tx, id);
      if (current.status !== 'DRAFT') {
        throw conflict(
          'Only drafts can be deleted; sent and cancelled campaigns are kept as a record.',
        );
      }
      await tx.emailCampaign.delete({ where: { id } });
      await this.audit.record(
        {
          actorId,
          action: 'newsletter.campaign_deleted',
          resourceType: 'email_campaign',
          resourceId: id,
          before: { name: current.name, subject: current.subject },
          meta,
        },
        tx,
      );
    });
    return { deleted: true };
  }

  /** One sender pass (run under the CMS sweep's distributed lock). */
  async runDue(
    now = new Date(),
  ): Promise<{ started: number; sent: number; failed: number; skipped: number }> {
    const result = { started: 0, sent: 0, failed: 0, skipped: 0 };

    // 1. Start due campaigns: snapshot every consenting subscriber, once.
    const due = await this.prisma.emailCampaign.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: now } },
      select: { id: true },
    });
    for (const { id } of due) {
      // One transaction, so a crash cannot leave a SENDING campaign with no
      // recipients (which would then be marked SENT having sent nothing).
      const started = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.emailCampaign.updateMany({
          where: { id, status: 'SCHEDULED' },
          data: { status: 'SENDING', startedAt: now },
        });
        if (!count) return false;
        await tx.$executeRaw`
          INSERT INTO email_campaign_deliveries (id, campaign_id, subscriber_id, status, created_at)
          SELECT gen_random_uuid(), ${id}::uuid, s.id, 'PENDING', now()
          FROM email_subscribers s WHERE s.status = 'SUBSCRIBED'
          ON CONFLICT (campaign_id, subscriber_id) DO NOTHING`;
        return true;
      });
      if (started) result.started++;
    }

    // 2. Claims left behind by a crash: failed, never resent.
    await this.prisma.emailCampaignDelivery.updateMany({
      where: { status: 'SENDING', claimedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } },
      data: {
        status: 'FAILED',
        error: 'Interrupted while sending; not retried to avoid duplicates',
      },
    });

    // 3. Send one batch across sending campaigns.
    let budget = this.env.CAMPAIGN_BATCH_SIZE;
    const sending = await this.prisma.emailCampaign.findMany({
      where: { status: 'SENDING' },
      orderBy: { startedAt: 'asc' },
    });
    const base = mediaBase(this.storage);
    for (const campaign of sending) {
      if (budget > 0) {
        const nodes = parseMarkdown(campaign.body, { mediaBase: base });
        const html = markdownToEmailHtml(nodes, this.env.WEB_APP_URL);
        const text = markdownToText(nodes);
        const claimed = await this.prisma.$queryRaw<{ id: string; subscriber_id: string }[]>`
          UPDATE email_campaign_deliveries d SET status = 'SENDING', claimed_at = now()
          WHERE d.id IN (
            SELECT id FROM email_campaign_deliveries
            WHERE campaign_id = ${campaign.id}::uuid AND status = 'PENDING'
            ORDER BY created_at, id
            LIMIT ${budget}
            FOR UPDATE SKIP LOCKED
          )
          RETURNING d.id, d.subscriber_id`;
        budget -= claimed.length;
        for (const delivery of claimed) {
          const outcome = await this.deliver(
            campaign,
            delivery.id,
            delivery.subscriber_id,
            html,
            text,
          );
          result[outcome]++;
        }
      }
      // 4. Finished when nothing is waiting or in flight.
      const open = await this.prisma.emailCampaignDelivery.count({
        where: { campaignId: campaign.id, status: { in: ['PENDING', 'SENDING'] } },
      });
      if (!open) {
        await this.prisma.emailCampaign.updateMany({
          where: { id: campaign.id, status: 'SENDING' },
          data: { status: 'SENT', completedAt: new Date() },
        });
      }
    }
    return result;
  }

  private async deliver(
    campaign: EmailCampaign,
    deliveryId: string,
    subscriberId: string,
    html: string,
    text: string,
  ): Promise<'sent' | 'failed' | 'skipped'> {
    const subscriber = await this.prisma.emailSubscriber.findUnique({
      where: { id: subscriberId },
    });
    // Consent is checked at the moment of sending, not only when queued.
    if (!subscriber || subscriber.status !== 'SUBSCRIBED') {
      await this.finish(deliveryId, 'SKIPPED', 'No longer subscribed');
      return 'skipped';
    }
    const urls = this.newsletter.unsubscribeUrls(subscriber.id);
    try {
      await this.transport.send(
        MailTemplates.campaign(
          subscriber.email,
          campaign.subject,
          html,
          text,
          urls.page,
          urls.oneClick,
        ),
      );
      await this.finish(deliveryId, 'SENT', null);
      return 'sent';
    } catch (error) {
      this.logger.warn('Campaign delivery failed', {
        event: 'campaign.delivery_failed',
        campaignId: campaign.id,
        deliveryId,
        ...describeError(error),
      });
      await this.finish(deliveryId, 'FAILED', (error as Error).message.slice(0, 300));
      return 'failed';
    }
  }

  private finish(id: string, status: 'SENT' | 'FAILED' | 'SKIPPED', error: string | null) {
    return this.prisma.emailCampaignDelivery.updateMany({
      where: { id, status: 'SENDING' },
      data: { status, error, ...(status === 'SENT' ? { sentAt: new Date() } : {}) },
    });
  }

  private eligible(): Promise<number> {
    return this.prisma.emailSubscriber.count({ where: { status: 'SUBSCRIBED' } });
  }

  private async stats(ids: string[]): Promise<Map<string, CampaignStats>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.emailCampaignDelivery.groupBy({
      by: ['campaignId', 'status'],
      where: { campaignId: { in: ids } },
      _count: { _all: true },
    });
    const map = new Map<string, CampaignStats>();
    for (const r of rows) {
      const s = map.get(r.campaignId) ?? { total: 0, pending: 0, sent: 0, failed: 0, skipped: 0 };
      s.total += r._count._all;
      if (r.status === 'PENDING' || r.status === 'SENDING') s.pending += r._count._all;
      if (r.status === 'SENT') s.sent += r._count._all;
      if (r.status === 'FAILED') s.failed += r._count._all;
      if (r.status === 'SKIPPED') s.skipped += r._count._all;
      map.set(r.campaignId, s);
    }
    return map;
  }

  private async locked(tx: Tx, id: string): Promise<EmailCampaign> {
    await tx.$queryRaw`SELECT id FROM email_campaigns WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.emailCampaign.findUnique({ where: { id } });
    if (!row) throw Errors.notFound('Campaign');
    return row;
  }
}

function view(
  row: EmailCampaign,
  stats: CampaignStats | undefined,
  eligible: number,
): AdminCampaignView {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    body: row.body,
    status: row.status,
    scheduledAt: iso(row.scheduledAt),
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    cancelledAt: iso(row.cancelledAt),
    stats: stats ?? { total: 0, pending: 0, sent: 0, failed: 0, skipped: 0 },
    eligibleRecipients: eligible,
    updatedAt: row.updatedAt.toISOString(),
  };
}

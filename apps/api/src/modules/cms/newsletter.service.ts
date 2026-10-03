import { createHmac, hkdfSync } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminSubscriberDetail,
  AdminSubscriberView,
  Paginated,
  adminSubscriberListQuerySchema,
  newsletterSubscribeSchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { paginate } from '../../common/http/response';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { EmailSubscriber, Prisma } from '../../generated/prisma/client';
import { generateSecret, safeEqual, sha256 } from '../../infrastructure/crypto/tokens';
import { MailService } from '../../infrastructure/mail/mail.service';
import { MailTemplates } from '../../infrastructure/mail/mail.templates';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { iso } from './cms-helpers';
import { SiteService } from './site.service';

type Out<T extends z.ZodType> = z.output<T>;
type Tx = Prisma.TransactionClient;

const CONFIRM_TTL_HOURS = 48;
const RETENTION_BATCH = 100;
/** Recorded when no custom consent statement is configured. */
export const DEFAULT_CONSENT_TEXT = 'I agree to receive the HavenHub newsletter by email.';

/**
 * Newsletter subscribers with explicit, recorded consent:
 * - signing up needs a ticked consent box; the statement shown is stored
 *   with the subscriber and in an append-only history;
 * - with double opt-in (the default, configurable) nobody receives
 *   campaigns until they confirm from their inbox, so an address cannot be
 *   signed up by someone else;
 * - every campaign email carries a one-click unsubscribe link;
 * - with a retention period set, people who unsubscribed or never confirmed
 *   are anonymised once it has passed (see `eraseExpired`).
 * Responses never reveal whether an address is already subscribed.
 */
@Injectable()
export class NewsletterService {
  private readonly unsubscribeKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly site: SiteService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.unsubscribeKey = Buffer.from(
      hkdfSync(
        'sha256',
        Buffer.from(env.AUTH_SECRET, 'base64'),
        '',
        'havenhub:newsletter-unsub:v1',
        32,
      ),
    );
  }

  /** The subscriber's permanent unsubscribe token (derived, so campaigns can rebuild it). */
  unsubscribeToken(subscriberId: string): string {
    const mac = createHmac('sha256', this.unsubscribeKey).update(subscriberId).digest('base64url');
    return `${subscriberId}.${mac}`;
  }

  unsubscribeUrls(subscriberId: string) {
    const token = encodeURIComponent(this.unsubscribeToken(subscriberId));
    const base = this.env.WEB_APP_URL.replace(/\/+$/, '');
    return {
      page: `${base}/newsletter/unsubscribe?token=${token}`,
      oneClick: `${base}/api/v1/newsletter/unsubscribe?token=${token}`,
    };
  }

  async subscribe(
    input: Out<typeof newsletterSubscribeSchema>,
    ip: string | undefined,
  ): Promise<{ received: true; confirmationRequired: boolean }> {
    const settings = await this.site.row();
    if (!settings.newsletterEnabled) throw Errors.notFound('Newsletter');
    const doubleOptIn = settings.newsletterDoubleOptIn;
    const consentText = settings.newsletterConsentText ?? DEFAULT_CONSENT_TEXT;
    const ipHash = ip ? sha256(`newsletter|${ip}`) : null;
    const now = new Date();

    const confirm = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`newsletter:${input.email}`}))`;
      const existing = await tx.emailSubscriber.findUnique({ where: { email: input.email } });
      // Already receiving it: nothing to do (and nothing to reveal).
      if (existing?.status === 'SUBSCRIBED') return null;

      const confirmSecret = doubleOptIn ? generateSecret() : null;
      const pending = {
        status: doubleOptIn ? ('PENDING' as const) : ('SUBSCRIBED' as const),
        consentText,
        consentSource: input.source,
        consentAt: now,
        confirmedAt: doubleOptIn ? null : now,
        unsubscribedAt: null,
        confirmTokenHash: confirmSecret ? sha256(confirmSecret) : null,
        confirmTokenExpiresAt: confirmSecret
          ? new Date(now.getTime() + CONFIRM_TTL_HOURS * 3600_000)
          : null,
      };
      let subscriber: EmailSubscriber;
      if (existing) {
        subscriber = await tx.emailSubscriber.update({ where: { id: existing.id }, data: pending });
      } else {
        // The id is needed to derive the unsubscribe token, so create then set it.
        subscriber = await tx.emailSubscriber.create({
          data: { email: input.email, ...pending, unsubscribeTokenHash: sha256(generateSecret()) },
        });
        subscriber = await tx.emailSubscriber.update({
          where: { id: subscriber.id },
          data: { unsubscribeTokenHash: sha256(this.unsubscribeToken(subscriber.id)) },
        });
      }
      await this.history(tx, subscriber.id, 'REQUESTED', {
        source: input.source,
        consentText,
        ipHash,
      });
      if (!doubleOptIn)
        await this.history(tx, subscriber.id, 'CONFIRMED', { source: input.source, ipHash });
      return confirmSecret;
    });

    if (confirm) {
      const url = `${this.env.WEB_APP_URL.replace(/\/+$/, '')}/newsletter/confirm?token=${encodeURIComponent(confirm)}`;
      await this.mail.send(MailTemplates.newsletterConfirm(input.email, url, CONFIRM_TTL_HOURS));
    }
    return { received: true, confirmationRequired: doubleOptIn };
  }

  async confirm(token: string, ip: string | undefined): Promise<{ confirmed: true }> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const subscriber = await tx.emailSubscriber.findUnique({
        where: { confirmTokenHash: sha256(token) },
      });
      if (
        !subscriber ||
        subscriber.status !== 'PENDING' ||
        !subscriber.confirmTokenExpiresAt ||
        subscriber.confirmTokenExpiresAt <= now
      ) {
        throw Errors.invalidToken('This confirmation link is invalid or has expired.');
      }
      const { count } = await tx.emailSubscriber.updateMany({
        where: {
          id: subscriber.id,
          status: 'PENDING',
          confirmTokenHash: subscriber.confirmTokenHash,
        },
        data: {
          status: 'SUBSCRIBED',
          confirmedAt: now,
          confirmTokenHash: null,
          confirmTokenExpiresAt: null,
        },
      });
      if (!count) throw Errors.invalidToken('This confirmation link is invalid or has expired.');
      await this.history(tx, subscriber.id, 'CONFIRMED', {
        source: 'email_link',
        ipHash: ip ? sha256(`newsletter|${ip}`) : null,
      });
    });
    return { confirmed: true };
  }

  /** Idempotent: unsubscribing twice is fine. */
  async unsubscribe(
    token: string,
    ip: string | undefined,
    source = 'email_link',
  ): Promise<{ unsubscribed: true }> {
    const dot = token.indexOf('.');
    const id = token.slice(0, dot);
    if (dot <= 0 || !safeEqual(this.unsubscribeToken(id), token)) {
      throw Errors.invalidToken('This unsubscribe link is invalid.');
    }
    await this.prisma.$transaction(async (tx) => {
      const subscriber = await tx.emailSubscriber.findUnique({
        where: { unsubscribeTokenHash: sha256(token) },
      });
      if (!subscriber) throw Errors.invalidToken('This unsubscribe link is invalid.');
      if (subscriber.status === 'UNSUBSCRIBED') return;
      await this.markUnsubscribed(
        tx,
        subscriber.id,
        source,
        ip ? sha256(`newsletter|${ip}`) : null,
        null,
      );
    });
    return { unsubscribed: true };
  }

  /**
   * Subscriber retention (configurable in site settings; off when unset).
   * Subscribers who unsubscribed, or whose confirmation link expired, longer
   * ago than the retention period have their address replaced and their
   * hashed IPs removed. The record and its consent history stay, without
   * personal data, ending in an ERASED event; current subscribers are never
   * touched. Runs from the CMS sweep.
   */
  async eraseExpired(now = new Date()): Promise<number> {
    const settings = await this.site.row();
    if (!settings.newsletterRetentionDays) return 0;
    const cutoff = new Date(now.getTime() - settings.newsletterRetentionDays * 86_400_000);
    const expired: Prisma.EmailSubscriberWhereInput = {
      erasedAt: null,
      OR: [
        { status: 'UNSUBSCRIBED', unsubscribedAt: { lt: cutoff } },
        { status: 'PENDING', confirmTokenExpiresAt: { lt: cutoff } },
      ],
    };
    const due = await this.prisma.emailSubscriber.findMany({
      where: expired,
      select: { id: true, email: true },
      take: RETENTION_BATCH,
    });
    let erased = 0;
    for (const sub of due) {
      const done = await this.prisma.$transaction(async (tx) => {
        // Same lock as `subscribe`, so a returning sign-up is never erased.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`newsletter:${sub.email}`}))`;
        const { count } = await tx.emailSubscriber.updateMany({
          where: { id: sub.id, ...expired },
          data: {
            email: `erased-${sub.id}@erased.invalid`,
            erasedAt: now,
            confirmTokenHash: null,
            confirmTokenExpiresAt: null,
          },
        });
        if (!count) return false;
        await tx.emailSubscriberEvent.updateMany({
          where: { subscriberId: sub.id },
          data: { ipHash: null },
        });
        await this.history(tx, sub.id, 'ERASED', { source: 'retention' });
        await this.audit.record(
          {
            actorId: null,
            action: 'newsletter.subscriber_retention_erased',
            resourceType: 'email_subscriber',
            resourceId: sub.id,
            after: { retentionDays: settings.newsletterRetentionDays },
          },
          tx,
        );
        return true;
      });
      if (done) erased++;
    }
    return erased;
  }

  // ── Admin ──

  async list(
    query: Out<typeof adminSubscriberListQuerySchema>,
  ): Promise<Paginated<AdminSubscriberView>> {
    const where: Prisma.EmailSubscriberWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { email: { contains: query.search.toLowerCase() } } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.emailSubscriber.count({ where }),
      this.prisma.emailSubscriber.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return paginate(rows.map(subscriberView), query.page, query.pageSize, total);
  }

  async detail(id: string): Promise<AdminSubscriberDetail> {
    const row = await this.prisma.emailSubscriber.findUnique({
      where: { id },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) throw Errors.notFound('Subscriber');
    return {
      ...subscriberView(row),
      consentText: row.consentText,
      history: row.events.map((e) => ({
        type: e.type,
        source: e.source,
        consentText: e.consentText,
        at: e.createdAt.toISOString(),
      })),
    };
  }

  /** An admin records an opt-out received another way (e.g. by email or phone). */
  async adminUnsubscribe(
    actorId: string,
    id: string,
    meta: RequestMeta,
  ): Promise<AdminSubscriberDetail> {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.emailSubscriber.findUnique({ where: { id } });
      if (!row) throw Errors.notFound('Subscriber');
      if (row.status !== 'UNSUBSCRIBED')
        await this.markUnsubscribed(tx, id, 'admin', null, actorId);
      await this.audit.record(
        {
          actorId,
          action: 'newsletter.subscriber_unsubscribed',
          resourceType: 'email_subscriber',
          resourceId: id,
          meta,
        },
        tx,
      );
    });
    return this.detail(id);
  }

  private async markUnsubscribed(
    tx: Tx,
    id: string,
    source: string,
    ipHash: string | null,
    actorId: string | null,
  ) {
    await tx.emailSubscriber.update({
      where: { id },
      data: {
        status: 'UNSUBSCRIBED',
        unsubscribedAt: new Date(),
        confirmTokenHash: null,
        confirmTokenExpiresAt: null,
      },
    });
    // Anything still queued for this person is not sent.
    await tx.emailCampaignDelivery.updateMany({
      where: { subscriberId: id, status: 'PENDING' },
      data: { status: 'SKIPPED', error: 'Unsubscribed' },
    });
    await this.history(tx, id, 'UNSUBSCRIBED', { source, ipHash, actorId });
  }

  private history(
    tx: Tx,
    subscriberId: string,
    type: 'REQUESTED' | 'CONFIRMED' | 'UNSUBSCRIBED' | 'ERASED',
    extra: {
      source?: string;
      consentText?: string;
      ipHash?: string | null;
      actorId?: string | null;
    },
  ) {
    return tx.emailSubscriberEvent.create({
      data: {
        subscriberId,
        type,
        source: extra.source ?? null,
        consentText: extra.consentText ?? null,
        ipHash: extra.ipHash ?? null,
        actorId: extra.actorId ?? null,
      },
    });
  }
}

const subscriberView = (row: EmailSubscriber): AdminSubscriberView => ({
  id: row.id,
  email: row.email,
  status: row.status,
  consentSource: row.consentSource,
  consentAt: iso(row.consentAt),
  confirmedAt: iso(row.confirmedAt),
  unsubscribedAt: iso(row.unsubscribedAt),
  createdAt: row.createdAt.toISOString(),
});

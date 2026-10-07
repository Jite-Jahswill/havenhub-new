import { HttpStatus, Injectable } from '@nestjs/common';
import {
  BookingStatus,
  ErrorCode,
  NotificationType,
  ratingSummary,
  reviewAuthorName,
  type AdminReviewView,
  type BookingReviewState,
  type Paginated,
  type PropertyReviewsPage,
  type adminReviewListQuerySchema,
  type createReviewSchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { AppException, Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BadgesService } from '../badges/badges.service';
import { CmsCacheService } from '../cms/cms-cache.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformPoliciesService } from '../platform/platform-policies.service';
import { PUBLIC_PROPERTY_WHERE } from '../properties/property.selects';

type Tx = Prisma.TransactionClient;
type Out<T extends z.ZodType> = z.output<T>;
const DAY_MS = 24 * 3600 * 1000;

const cannotReview = (message: string) =>
  new AppException(HttpStatus.CONFLICT, ErrorCode.INVALID_STATUS_TRANSITION, message);

/**
 * Reviews: one per completed booking, by its customer, within the reviews
 * policy's window after check-out. Published at once; administrators may
 * hide one. The property's rating counters and its earned badges change in
 * the same transaction as the review.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly badges: BadgesService,
    private readonly notifications: NotificationsService,
    private readonly policies: PlatformPoliciesService,
    private readonly cms: CmsCacheService,
  ) {}

  /** What the customer's booking page shows about reviewing. */
  async stateFor(booking: {
    id: string;
    status: string;
    completedAt: Date | null;
  }): Promise<BookingReviewState> {
    const review = await this.prisma.review.findUnique({ where: { bookingId: booking.id } });
    if (review) {
      return {
        review: {
          rating: review.rating,
          comment: review.comment,
          createdAt: review.createdAt.toISOString(),
          hidden: review.status === 'HIDDEN',
        },
        canReview: false,
        reviewBy: null,
      };
    }
    const { reviews } = await this.policies.get();
    const deadline = booking.completedAt
      ? new Date(booking.completedAt.getTime() + reviews.windowDays * DAY_MS)
      : null;
    const open =
      reviews.enabled &&
      booking.status === BookingStatus.COMPLETED &&
      deadline !== null &&
      deadline > new Date();
    return { review: null, canReview: open, reviewBy: open ? deadline.toISOString() : null };
  }

  async create(
    customerId: string,
    bookingId: string,
    input: Out<typeof createReviewSchema>,
    meta: RequestMeta,
  ): Promise<BookingReviewState> {
    const { reviews } = await this.policies.get();
    if (!reviews.enabled) throw Errors.featureDisabled('Reviews are turned off right now.');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`;
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: {
          review: { select: { id: true } },
          property: {
            select: { id: true, title: true, agentProfile: { select: { userId: true } } },
          },
        },
      });
      // Someone else's booking looks like no booking at all.
      if (!booking || booking.customerId !== customerId) throw Errors.notFound('Booking');
      if (booking.review) throw cannotReview('You have already reviewed this stay.');
      if (booking.status !== BookingStatus.COMPLETED || !booking.completedAt) {
        throw cannotReview('You can review a stay once it is completed.');
      }
      if (Date.now() > booking.completedAt.getTime() + reviews.windowDays * DAY_MS) {
        throw cannotReview(
          `Reviews can be written up to ${reviews.windowDays} days after check-out.`,
        );
      }
      const review = await tx.review.create({
        data: {
          bookingId,
          propertyId: booking.propertyId,
          customerId,
          rating: input.rating,
          comment: input.comment ?? null,
        },
      });
      await this.count(tx, booking.propertyId, input.rating, 1);
      await this.audit.record(
        {
          actorId: customerId,
          action: 'review.created',
          resourceType: 'review',
          resourceId: review.id,
          after: { bookingId, propertyId: booking.propertyId, rating: input.rating },
          meta,
        },
        tx,
      );
      await this.notifications.notify(tx, [
        {
          userId: booking.property.agentProfile.userId,
          type: NotificationType.REVIEW_RECEIVED,
          title: `New ${input.rating}-star review`,
          body: `A guest reviewed “${booking.property.title}”${input.comment ? `: “${clip(input.comment, 200)}”` : '.'}`,
          link: `/agent/bookings/${bookingId}`,
        },
      ]);
    });
    await this.cms.invalidate();
    const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    return this.stateFor(booking);
  }

  /** Public: published reviews of a public property, newest first. */
  async forProperty(slug: string, page: number, pageSize: number): Promise<PropertyReviewsPage> {
    const property = await this.prisma.property.findFirst({
      where: { ...PUBLIC_PROPERTY_WHERE, slug },
      select: { id: true, ratingSum: true, reviewCount: true },
    });
    if (!property) throw Errors.notFound('Property');
    const where = { propertyId: property.id, status: 'PUBLISHED' };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.review.count({ where }),
      this.prisma.review.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { customer: { select: { fullName: true } } },
      }),
    ]);
    return {
      rating: ratingSummary(property.ratingSum, property.reviewCount),
      items: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        authorName: reviewAuthorName(r.customer.fullName),
        createdAt: r.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // ── Moderation ──

  async adminList(
    query: Out<typeof adminReviewListQuerySchema>,
  ): Promise<Paginated<AdminReviewView>> {
    const where: Prisma.ReviewWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.rating ? { rating: query.rating } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.review.count({ where }),
      this.prisma.review.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          property: { select: { id: true, slug: true, title: true } },
          customer: { select: { id: true, fullName: true, email: true } },
          booking: { select: { reference: true } },
        },
      }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        status: r.status as 'PUBLISHED' | 'HIDDEN',
        hiddenReason: r.hiddenReason,
        property: r.property,
        customer: r.customer,
        bookingReference: r.booking.reference,
        createdAt: r.createdAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  /** Hides (with a reason) or restores; a hidden review stops counting towards stars and badges. */
  async setHidden(
    actorId: string,
    id: string,
    hide: { reason: string } | null,
    meta: RequestMeta,
  ): Promise<{ status: 'PUBLISHED' | 'HIDDEN' }> {
    const status = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM reviews WHERE id = ${id}::uuid FOR UPDATE`;
      const review = await tx.review.findUnique({ where: { id } });
      if (!review) throw Errors.notFound('Review');
      const target = hide ? 'HIDDEN' : 'PUBLISHED';
      if (review.status === target) return target;
      await tx.review.update({
        where: { id },
        data: hide
          ? {
              status: 'HIDDEN',
              hiddenReason: hide.reason,
              hiddenById: actorId,
              hiddenAt: new Date(),
            }
          : { status: 'PUBLISHED', hiddenReason: null, hiddenById: null, hiddenAt: null },
      });
      await this.count(tx, review.propertyId, review.rating, hide ? -1 : 1);
      await this.audit.record(
        {
          actorId,
          action: hide ? 'review.hidden' : 'review.restored',
          resourceType: 'review',
          resourceId: id,
          before: { status: review.status },
          after: { status: target, reason: hide?.reason ?? null },
          meta,
        },
        tx,
      );
      return target;
    });
    await this.cms.invalidate();
    return { status };
  }

  /** Adjusts the property's counters by one review, then its earned badges. */
  private async count(tx: Tx, propertyId: string, rating: number, sign: 1 | -1) {
    await tx.property.update({
      where: { id: propertyId },
      data: {
        ratingSum: { increment: sign * rating },
        reviewCount: { increment: sign },
      },
    });
    await this.badges.recompute(tx, { propertyIds: [propertyId] });
  }
}

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

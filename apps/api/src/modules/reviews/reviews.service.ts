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
import { PUBLIC_EXPERIENCE_WHERE } from '../experiences/experience.selects';
import { PUBLIC_PROPERTY_WHERE } from '../properties/property.selects';

type Tx = Prisma.TransactionClient;
type ReviewTarget = { propertyId: string } | { experienceId: string };

const EXPERIENCE_SEGMENT: Record<string, string> = {
  EVENT: 'events',
  TOUR: 'tours',
  HOTEL: 'hotels',
  CLEANING: 'cleaning',
};
type Out<T extends z.ZodType> = z.output<T>;
const DAY_MS = 24 * 3600 * 1000;

const cannotReview = (message: string) =>
  new AppException(HttpStatus.CONFLICT, ErrorCode.INVALID_STATUS_TRANSITION, message);

/**
 * Reviews: one per completed booking (a rental, or a tour, event, hotel or
 * cleaning booking), by its customer, within the reviews policy's window
 * after it ends. Published at once; administrators may hide one. The
 * listing's rating counters (and a property's earned badges) change in the
 * same transaction as the review.
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
          experience: {
            select: { id: true, title: true, agentProfile: { select: { userId: true } } },
          },
        },
      });
      // Someone else's booking looks like no booking at all.
      if (!booking || booking.customerId !== customerId) throw Errors.notFound('Booking');
      const listing = booking.property ?? booking.experience;
      if (!listing) throw Errors.notFound('Booking');
      if (booking.review) throw cannotReview('You have already reviewed this booking.');
      if (booking.status !== BookingStatus.COMPLETED || !booking.completedAt) {
        throw cannotReview('You can write a review once the booking is completed.');
      }
      if (Date.now() > booking.completedAt.getTime() + reviews.windowDays * DAY_MS) {
        throw cannotReview(
          `Reviews can be written up to ${reviews.windowDays} days after it ends.`,
        );
      }
      const target: ReviewTarget = booking.property
        ? { propertyId: booking.property.id }
        : { experienceId: booking.experience!.id };
      const review = await tx.review.create({
        data: {
          bookingId,
          ...target,
          customerId,
          rating: input.rating,
          comment: input.comment ?? null,
        },
      });
      await this.count(tx, target, input.rating, 1);
      await this.audit.record(
        {
          actorId: customerId,
          action: 'review.created',
          resourceType: 'review',
          resourceId: review.id,
          after: { bookingId, ...target, rating: input.rating },
          meta,
        },
        tx,
      );
      await this.notifications.notify(tx, [
        {
          userId: listing.agentProfile.userId,
          type: NotificationType.REVIEW_RECEIVED,
          title: `New ${input.rating}-star review`,
          body: `A guest reviewed “${listing.title}”${input.comment ? `: “${clip(input.comment, 200)}”` : '.'}`,
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
    return this.page(
      { propertyId: property.id, status: 'PUBLISHED' },
      ratingSummary(property.ratingSum, property.reviewCount),
      page,
      pageSize,
    );
  }

  /** Public: published reviews of a public tour, event, hotel or cleaning service. */
  async forExperience(slug: string, page: number, pageSize: number): Promise<PropertyReviewsPage> {
    const experience = await this.prisma.experience.findFirst({
      where: { ...PUBLIC_EXPERIENCE_WHERE, slug },
      select: { id: true, ratingSum: true, reviewCount: true },
    });
    if (!experience) throw Errors.notFound('Listing');
    return this.page(
      { experienceId: experience.id, status: 'PUBLISHED' },
      ratingSummary(experience.ratingSum, experience.reviewCount),
      page,
      pageSize,
    );
  }

  private async page(
    where: Prisma.ReviewWhereInput,
    rating: PropertyReviewsPage['rating'],
    page: number,
    pageSize: number,
  ): Promise<PropertyReviewsPage> {
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
      rating,
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
          experience: { select: { id: true, slug: true, kind: true, title: true } },
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
        listing: r.property
          ? { id: r.property.id, title: r.property.title, href: `/properties/${r.property.slug}` }
          : {
              id: r.experience!.id,
              title: r.experience!.title,
              href: `/${EXPERIENCE_SEGMENT[r.experience!.kind]}/${r.experience!.slug}`,
            },
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
      await this.count(
        tx,
        review.propertyId
          ? { propertyId: review.propertyId }
          : { experienceId: review.experienceId! },
        review.rating,
        hide ? -1 : 1,
      );
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

  /** Adjusts the listing's counters by one review (and a property's earned badges). */
  private async count(tx: Tx, target: ReviewTarget, rating: number, sign: 1 | -1) {
    const data = { ratingSum: { increment: sign * rating }, reviewCount: { increment: sign } };
    if ('propertyId' in target) {
      await tx.property.update({ where: { id: target.propertyId }, data });
      await this.badges.recompute(tx, { propertyIds: [target.propertyId] });
    } else {
      await tx.experience.update({ where: { id: target.experienceId }, data });
    }
  }
}

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

import { Injectable, Logger } from '@nestjs/common';
import {
  AccountType,
  ChatEvent,
  NIGERIAN_STATES,
  NotificationType,
  experienceSearchQuerySchema,
  formatKobo,
  propertySearchQuerySchema,
  type AssistantCard,
  type AssistantHandoffResult,
  type AssistantIntent,
  type AssistantQuestionView,
  type AssistantReply,
  type AssistantStatsView,
  type ExperienceKind,
  type Paginated,
  type PricingPeriod,
  type PropertyCard,
  type assistantHandoffSchema,
  type assistantQuestionsQuerySchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { paginate } from '../../common/http/response';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { ChatEventsService } from '../chat/chat-events.service';
import { ConversationsService } from '../chat/conversations.service';
import { MessagesService } from '../chat/messages.service';
import { ExperienceSearchService } from '../experiences/experience-search.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformPoliciesService } from '../platform/platform-policies.service';
import { PropertySearchService } from '../properties/property-search.service';
import {
  parseQuestion,
  type KnownPlaces,
  type ParsedQuestion,
  type PlaceMatch,
  type PropertyFilters,
} from './assistant-nlp';

const RESULTS = 5;
const PLACES_TTL_MS = 10 * 60_000;
const FAQ_TTL_MS = 5 * 60_000;
const RETENTION_DAYS = 180;

const KIND_PATH: Record<ExperienceKind, string> = {
  EVENT: '/events',
  TOUR: '/tours',
  HOTEL: '/hotels',
  CLEANING: '/cleaning',
};
const KIND_NOUN: Record<ExperienceKind, string> = {
  EVENT: 'events',
  TOUR: 'tours',
  HOTEL: 'hotels',
  CLEANING: 'cleaning services',
};
const PERIOD_SUFFIX: Record<PricingPeriod, string> = {
  DAILY: ' / night',
  MONTHLY: ' / month',
  YEARLY: ' / year',
  SALE: '',
};
const BOOKING_STATUS_LABEL: Record<string, string> = {
  AWAITING_PAYMENT: 'Awaiting payment',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired (not paid)',
  COMPLETED: 'Completed',
};
const REFUND_STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Requested — waiting for review',
  PROCESSING: 'Approved — being paid back',
  COMPLETED: 'Refunded',
  REJECTED: 'Not approved',
  FAILED: 'Failed — our team will retry',
};

const SUGGESTIONS = [
  'Apartments in Lekki under 3m a year',
  'Shortlets in Abuja',
  'Tours in Uyo',
  'Where is my refund?',
];

interface FaqEntry {
  title: string;
  answer: string;
  href: string;
  words: Set<string>;
}

/**
 * The "Ask HavenHub" assistant. Understands a question with the rule-based
 * parser, answers it from HavenHub's own data (search, the visitor's own
 * bookings and refunds, FAQs and help articles), and hands over to the
 * support queue on request. Read-only: it never changes a booking or refund.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private places: { at: number; value: KnownPlaces } | null = null;
  private faqs: { at: number; value: FaqEntry[] } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: PlatformPoliciesService,
    private readonly properties: PropertySearchService,
    private readonly experiences: ExperienceSearchService,
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
    private readonly chatEvents: ChatEventsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async ask(text: string, viewer?: AuthContext): Promise<AssistantReply> {
    const { assistant } = await this.policies.get();
    if (!assistant.enabled) throw Errors.featureDisabled('The assistant is turned off.');

    const parsed = parseQuestion(text, await this.knownPlaces());
    const reply = await this.answer(parsed, viewer, assistant.handoffEnabled);
    await this.log(text, reply, viewer?.user.id ?? null);
    return reply;
  }

  async handoff(
    auth: AuthContext,
    input: z.output<typeof assistantHandoffSchema>,
    meta: RequestMeta,
  ): Promise<AssistantHandoffResult> {
    const { assistant } = await this.policies.get();
    if (!assistant.enabled || !assistant.handoffEnabled) {
      throw Errors.featureDisabled('Talking to a person from the assistant is turned off.');
    }
    // The ordinary support conversation (one per person); staff answer it from the queue.
    const conversation = await this.conversations.start(auth, { contextType: 'SUPPORT' });
    const lines = input.transcript
      .slice(-10)
      .map((t) => `${t.from === 'user' ? 'Them' : 'Assistant'}: ${t.text}`)
      .join('\n');
    const body = [
      'Passed on by the HavenHub assistant. A member of the support team will reply here.',
      input.question ? `Question: “${input.question}”` : null,
      lines ? `Recent conversation:\n${lines}` : null,
    ]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 4000);

    const staff = await this.supportStaff();
    const messageId = await this.prisma.$transaction(async (tx) => {
      const id = await this.messages.createSystem(tx, conversation.id, body, {
        event: 'assistant.handoff',
      });
      await this.notifications.notify(
        tx,
        staff.map((userId) => ({
          userId,
          type: NotificationType.SUPPORT_REQUEST,
          title: `${auth.user.fullName} asked for a person`,
          body: input.question?.slice(0, 200) ?? 'From the HavenHub assistant.',
          link: '/admin/support',
        })),
      );
      await this.audit.record(
        {
          actorId: auth.user.id,
          action: 'assistant.handoff',
          resourceType: 'conversation',
          resourceId: conversation.id,
          meta,
        },
        tx,
      );
      return id;
    });
    await this.chatEvents.messageChanged(ChatEvent.MESSAGE_CREATED, messageId);
    await this.chatEvents.conversation(ChatEvent.CONVERSATION_UPDATED, conversation.id);
    if (input.question) {
      await this.prisma.assistantQuestion.create({
        data: {
          userId: auth.user.id,
          text: input.question.slice(0, 500),
          intent: 'HANDOFF',
          answered: false,
          handedOff: true,
        },
      });
    }
    return { conversationId: conversation.id };
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  async questions(
    query: z.output<typeof assistantQuestionsQuerySchema>,
  ): Promise<Paginated<AssistantQuestionView>> {
    const where = query.unanswered ? { answered: false } : {};
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.assistantQuestion.count({ where }),
      this.prisma.assistantQuestion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { user: { select: { id: true, fullName: true } } },
      }),
    ]);
    return paginate(
      rows.map((r) => ({
        id: r.id,
        text: r.text,
        intent: r.intent as AssistantIntent,
        answered: r.answered,
        handedOff: r.handedOff,
        user: r.user ? { id: r.user.id, name: r.user.fullName } : null,
        createdAt: r.createdAt.toISOString(),
      })),
      query.page,
      query.pageSize,
      total,
    );
  }

  async stats(now = new Date()): Promise<AssistantStatsView> {
    const where = { createdAt: { gte: new Date(now.getTime() - 30 * 24 * 3600 * 1000) } };
    const [questions, answered, handedOff, byIntent] = await Promise.all([
      this.prisma.assistantQuestion.count({ where }),
      this.prisma.assistantQuestion.count({ where: { ...where, answered: true } }),
      this.prisma.assistantQuestion.count({ where: { ...where, handedOff: true } }),
      this.prisma.assistantQuestion.groupBy({ by: ['intent'], where, _count: { _all: true } }),
    ]);
    return {
      questions,
      answered,
      handedOff,
      byIntent: byIntent
        .map((r) => ({ intent: r.intent as AssistantIntent, count: r._count._all }))
        .sort((a, b) => b.count - a.count),
    };
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const { count } = await this.prisma.assistantQuestion.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return count;
  }

  // ── Answers ──────────────────────────────────────────────────────────────

  private async answer(
    q: ParsedQuestion,
    viewer: AuthContext | undefined,
    handoffEnabled: boolean,
  ): Promise<AssistantReply> {
    const reply = (
      r: Partial<AssistantReply> & Pick<AssistantReply, 'intent' | 'text'>,
    ): AssistantReply => ({
      cards: [],
      link: null,
      suggestions: [],
      needsSignIn: false,
      ...r,
      offerHandoff: handoffEnabled && (r.offerHandoff ?? false),
    });

    switch (q.intent) {
      case 'GREETING':
        return reply({
          intent: q.intent,
          text: 'Hello! What can I help you find today?',
          suggestions: SUGGESTIONS,
        });
      case 'THANKS':
        return reply({ intent: q.intent, text: 'You’re welcome! Anything else?' });
      case 'CAPABILITIES':
        return reply({
          intent: q.intent,
          text: 'I can search properties by place, price, bedrooms and type; find tours, events, hotels and cleaning services; check your bookings and refunds; and answer questions about how HavenHub works. If I can’t help, I’ll pass you to our support team.',
          suggestions: SUGGESTIONS,
          offerHandoff: true,
        });
      case 'HANDOFF':
        return reply({
          intent: q.intent,
          text: handoffEnabled
            ? 'Sure — I’ll pass you to our support team. They’ll reply in your HavenHub messages.'
            : 'Our support team is reachable from the Help centre.',
          link: handoffEnabled ? null : { label: 'Open the Help centre', href: '/help' },
          offerHandoff: true,
          needsSignIn: handoffEnabled && !viewer,
        });
      case 'REFUND_STATUS':
        return reply({ intent: q.intent, ...(await this.refunds(viewer)), offerHandoff: true });
      case 'BOOKING_STATUS':
        return reply({
          intent: q.intent,
          ...(await this.bookings(viewer, q.bookingReference)),
          offerHandoff: true,
        });
      case 'PROPERTY_SEARCH':
        return reply({ intent: q.intent, ...(await this.searchProperties(q.property!, viewer)) });
      case 'EXPERIENCE_SEARCH':
        return reply({ intent: q.intent, ...(await this.searchExperiences(q.experience!)) });
      default: {
        const faq = await this.matchFaq(q.keywords);
        if (faq) {
          return reply({
            intent: 'FAQ',
            text: faq.answer,
            link: { label: `Read more: ${faq.title}`, href: faq.href },
            offerHandoff: true,
          });
        }
        return reply({
          intent: 'UNKNOWN',
          text: 'Sorry, I didn’t quite get that. Try asking about properties, tours or your bookings — or talk to our support team.',
          suggestions: SUGGESTIONS,
          link: { label: 'Browse the Help centre', href: '/help' },
          offerHandoff: true,
        });
      }
    }
  }

  private async refunds(viewer?: AuthContext): Promise<Partial<AssistantReply> & { text: string }> {
    if (!viewer) {
      return { text: 'Sign in and I’ll check your refunds for you.', needsSignIn: true };
    }
    const rows = await this.prisma.refund.findMany({
      where: { booking: { customerId: viewer.user.id } },
      orderBy: { createdAt: 'desc' },
      take: RESULTS,
      select: {
        status: true,
        amountKobo: true,
        createdAt: true,
        completedAt: true,
        booking: { select: { id: true, reference: true, property: { select: { title: true } } } },
      },
    });
    if (rows.length === 0) {
      return {
        text: 'You don’t have any refunds. If you cancelled a paid booking recently, it can take a moment to appear.',
        link: { label: 'Your bookings', href: '/account/bookings' },
      };
    }
    const latest = rows[0]!;
    return {
      text: `Your latest refund (${latest.booking.reference}) of ${formatKobo(Number(latest.amountKobo))}: ${REFUND_STATUS_LABEL[latest.status]!.toLowerCase()}.`,
      cards: rows.map((r) => ({
        title: r.booking.property.title,
        subtitle: `${r.booking.reference} · ${formatKobo(Number(r.amountKobo))} · requested ${r.createdAt.toISOString().slice(0, 10)}`,
        href: `/account/bookings/${r.booking.id}`,
        imageUrl: null,
        badge: REFUND_STATUS_LABEL[r.status] ?? r.status,
      })),
      link: { label: 'Your payments and refunds', href: '/account/payments' },
    };
  }

  private async bookings(
    viewer: AuthContext | undefined,
    reference?: string,
  ): Promise<Partial<AssistantReply> & { text: string }> {
    if (!viewer) {
      return { text: 'Sign in and I’ll look up your bookings.', needsSignIn: true };
    }
    if (viewer.user.accountType === AccountType.AGENT) {
      return {
        text: 'Bookings of your listings are in your agent dashboard.',
        link: { label: 'Open your bookings', href: '/agent/bookings' },
      };
    }
    const rows = await this.prisma.booking.findMany({
      // Only the visitor's own bookings, even when they type someone else's reference.
      where: { customerId: viewer.user.id, ...(reference ? { reference } : {}) },
      orderBy: { createdAt: 'desc' },
      take: RESULTS,
      select: {
        id: true,
        reference: true,
        status: true,
        startDate: true,
        endDate: true,
        totalKobo: true,
        property: { select: { title: true } },
      },
    });
    if (rows.length === 0) {
      return {
        text: reference
          ? `I couldn’t find booking ${reference} on your account.`
          : 'You don’t have any bookings yet.',
        link: { label: 'Find a place to stay', href: '/properties' },
      };
    }
    const latest = rows[0]!;
    return {
      text: reference
        ? `Booking ${latest.reference}: ${BOOKING_STATUS_LABEL[latest.status]!.toLowerCase()}.`
        : `Your most recent booking (${latest.reference}) is ${BOOKING_STATUS_LABEL[latest.status]!.toLowerCase()}.`,
      cards: rows.map((b) => ({
        title: b.property.title,
        subtitle: `${b.reference} · ${b.startDate.toISOString().slice(0, 10)} to ${b.endDate.toISOString().slice(0, 10)} · ${formatKobo(Number(b.totalKobo))}`,
        href: `/account/bookings/${b.id}`,
        imageUrl: null,
        badge: BOOKING_STATUS_LABEL[b.status] ?? b.status,
      })),
      link: { label: 'All your bookings', href: '/account/bookings' },
    };
  }

  private async searchProperties(
    f: PropertyFilters,
    viewer?: AuthContext,
  ): Promise<Partial<AssistantReply> & { text: string }> {
    const query: Record<string, string> = { pageSize: String(RESULTS) };
    if (f.listingType) query.listingType = f.listingType;
    if (f.propertyType) query.propertyType = f.propertyType.join(',');
    if (f.pricingPeriod) query.pricingPeriod = f.pricingPeriod.join(',');
    if (f.minPriceKobo !== undefined) query.minPrice = String(f.minPriceKobo);
    if (f.maxPriceKobo !== undefined) query.maxPrice = String(f.maxPriceKobo);
    if (f.minBedrooms !== undefined) query.minBedrooms = String(f.minBedrooms);
    if (f.furnished) query.furnished = 'true';
    if (f.onOffer) query.onOffer = 'true';
    if (f.sort) query.sort = f.sort;

    let place = f.place;
    let result = await this.properties.search(
      propertySearchQuerySchema.parse({ ...query, ...placeQuery(place) }),
      viewer,
    );
    // Nothing in that city yet: widen to its state.
    if (result.total === 0 && place?.city && place.state) {
      const wider = await this.properties.search(
        propertySearchQuerySchema.parse({ ...query, state: place.state }),
        viewer,
      );
      if (wider.total > 0) {
        result = wider;
        place = { state: place.state, label: `${place.state} (nothing in ${place.city} yet)` };
      }
    }
    const searchUrl = `/properties?${new URLSearchParams({ ...query, ...placeQuery(place), pageSize: '18' }).toString()}`;
    const where = place ? ` in ${place.label}` : '';
    if (result.total === 0) {
      return {
        text: `I couldn’t find any matching properties${where} right now. Try a wider budget or a nearby area.`,
        link: { label: 'Open the property search', href: '/properties' },
        suggestions: place
          ? [`Properties in ${place.state ?? place.label}`]
          : SUGGESTIONS.slice(0, 2),
        offerHandoff: true,
      };
    }
    return {
      text: `I found ${result.total} ${result.total === 1 ? 'property' : 'properties'}${where}${describeFilters(f)}. Here ${result.total === 1 ? 'it is' : `are the top ${Math.min(RESULTS, result.items.length)}`}:`,
      cards: result.items.slice(0, RESULTS).map(propertyCard),
      link: result.total > RESULTS ? { label: `See all ${result.total}`, href: searchUrl } : null,
    };
  }

  private async searchExperiences(e: {
    kind: ExperienceKind;
    place?: PlaceMatch;
  }): Promise<Partial<AssistantReply> & { text: string }> {
    const { events } = await this.policies.get();
    const noun = KIND_NOUN[e.kind];
    if (!events[e.kind]) {
      return { text: `HavenHub doesn’t list ${noun} at the moment.`, suggestions: SUGGESTIONS };
    }
    const search = (place?: PlaceMatch) =>
      this.experiences.search(
        experienceSearchQuerySchema.parse({
          kind: e.kind,
          pageSize: String(RESULTS),
          ...(e.kind === 'EVENT' ? { sort: 'soonest' } : {}),
          ...placeQuery(place),
        }),
      );
    let place = e.place;
    let result = await search(place);
    if (result.total === 0 && place?.city && place.state) {
      const wider = await search({ state: place.state, label: place.state });
      if (wider.total > 0) {
        result = wider;
        place = { state: place.state, label: `${place.state} (nothing in ${place.city} yet)` };
      }
    }
    const where = place ? ` in ${place.label}` : '';
    const listUrl = `${KIND_PATH[e.kind]}?${new URLSearchParams(placeQuery(place)).toString()}`;
    if (result.total === 0) {
      return {
        text: `There are no ${noun}${where} on HavenHub yet.`,
        link: { label: `See all ${noun}`, href: KIND_PATH[e.kind] },
        offerHandoff: true,
      };
    }
    return {
      text: `Here are ${e.kind === 'EVENT' ? 'upcoming events' : `top ${noun}`}${where}:`,
      cards: result.items.slice(0, RESULTS).map((x) => ({
        title: x.title,
        subtitle: [x.city, x.state].filter(Boolean).join(', ') || null,
        href: `${KIND_PATH[x.kind]}/${x.slug}`,
        imageUrl: x.coverImage?.thumbnailUrl ?? null,
        badge: x.priceFromKobo !== null ? `From ${formatKobo(x.priceFromKobo)}` : null,
      })),
      link: result.total > RESULTS ? { label: `See all ${result.total}`, href: listUrl } : null,
    };
  }

  /** Best keyword overlap with a published FAQ or help article, if good enough. */
  private async matchFaq(keywords: string[]): Promise<FaqEntry | null> {
    if (keywords.length === 0) return null;
    const words = new Set(keywords.map(stem));
    let best: { entry: FaqEntry; score: number } | null = null;
    for (const entry of await this.faqEntries()) {
      let hits = 0;
      for (const w of words) if (entry.words.has(w)) hits += 1;
      const score = hits / Math.max(2, words.size);
      if (hits >= 1 && (!best || score > best.score)) best = { entry, score };
    }
    return best && best.score >= 0.34 ? best.entry : null;
  }

  private async faqEntries(): Promise<FaqEntry[]> {
    if (this.faqs && Date.now() - this.faqs.at < FAQ_TTL_MS) return this.faqs.value;
    const [faqs, articles] = await Promise.all([
      this.prisma.faq.findMany({
        where: { published: true },
        orderBy: { sortOrder: 'asc' },
        take: 300,
        select: { question: true, answer: true, category: { select: { slug: true } } },
      }),
      this.prisma.helpArticle.findMany({
        where: { status: 'PUBLISHED' },
        orderBy: { sortOrder: 'asc' },
        take: 300,
        select: { slug: true, title: true, summary: true },
      }),
    ]);
    const value: FaqEntry[] = [
      ...faqs.map((f) => ({
        title: f.question,
        answer: plain(f.answer),
        href: f.category ? `/help/category/${f.category.slug}` : '/help',
        words: wordsOf(f.question),
      })),
      ...articles.map((a) => ({
        title: a.title,
        answer: a.summary ?? `This help article explains it: “${a.title}”.`,
        href: `/help/${a.slug}`,
        words: wordsOf(`${a.title} ${a.summary ?? ''}`),
      })),
    ];
    this.faqs = { at: Date.now(), value };
    return value;
  }

  private async knownPlaces(): Promise<KnownPlaces> {
    if (this.places && Date.now() - this.places.at < PLACES_TTL_MS) return this.places.value;
    const [properties, experiences] = await Promise.all([
      this.prisma.property.findMany({
        where: { status: 'PUBLISHED', city: { not: null }, state: { not: null } },
        distinct: ['city', 'state'],
        select: { city: true, state: true },
        take: 2000,
      }),
      this.prisma.experience.findMany({
        where: { status: 'PUBLISHED', city: { not: null }, state: { not: null } },
        distinct: ['city', 'state'],
        select: { city: true, state: true },
        take: 2000,
      }),
    ]);
    const seen = new Map<string, { city: string; state: string }>();
    for (const r of [...properties, ...experiences]) {
      const city = r.city!.trim();
      if (city.length >= 3) seen.set(city.toLowerCase(), { city, state: r.state! });
    }
    const value = { states: NIGERIAN_STATES, cities: [...seen.values()] };
    this.places = { at: Date.now(), value };
    return value;
  }

  private async supportStaff(): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: {
        accountType: AccountType.ADMIN,
        status: 'ACTIVE',
        roles: {
          some: { role: { permissions: { some: { permission: { key: 'support.respond' } } } } },
        },
      },
      select: { id: true },
      take: 200,
    });
    return rows.map((r) => r.id);
  }

  private async log(text: string, reply: AssistantReply, userId: string | null): Promise<void> {
    try {
      await this.prisma.assistantQuestion.create({
        data: {
          userId,
          text: text.slice(0, 500),
          intent: reply.intent,
          answered: reply.intent !== 'UNKNOWN' && !(reply.cards.length === 0 && isSearch(reply)),
        },
      });
      // Occasional, cheap retention sweep (indexed on created_at).
      if (Math.random() < 0.01) {
        await this.deleteOlderThan(new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000));
      }
    } catch (error) {
      // Logging never breaks an answer.
      this.logger.warn(`Could not log assistant question: ${(error as Error).message}`);
    }
  }
}

const isSearch = (r: AssistantReply) =>
  r.intent === 'PROPERTY_SEARCH' || r.intent === 'EXPERIENCE_SEARCH';

function placeQuery(place?: PlaceMatch): Record<string, string> {
  if (!place) return {};
  if (place.city) return { city: place.city, ...(place.state ? { state: place.state } : {}) };
  return place.state ? { state: place.state } : {};
}

function propertyCard(p: PropertyCard): AssistantCard {
  return {
    title: p.title,
    subtitle: `${p.city}, ${p.state}`,
    href: `/properties/${p.slug}`,
    imageUrl: p.coverImage?.thumbnailUrl ?? null,
    badge: `${formatKobo(p.priceKobo)}${PERIOD_SUFFIX[p.pricingPeriod]}`,
  };
}

function describeFilters(f: PropertyFilters): string {
  const parts: string[] = [];
  if (f.minBedrooms) parts.push(`${f.minBedrooms}+ bedrooms`);
  if (f.minPriceKobo !== undefined && f.maxPriceKobo !== undefined) {
    parts.push(`${formatKobo(f.minPriceKobo)}–${formatKobo(f.maxPriceKobo)}`);
  } else if (f.maxPriceKobo !== undefined) parts.push(`up to ${formatKobo(f.maxPriceKobo)}`);
  else if (f.minPriceKobo !== undefined) parts.push(`from ${formatKobo(f.minPriceKobo)}`);
  if (f.listingType === 'SALE') parts.push('for sale');
  if (f.onOffer) parts.push('on offer');
  return parts.length ? ` (${parts.join(', ')})` : '';
}

const STOP = new Set(
  'the and for with you your how what when where why can does did are was have has from this that about into our will would should could their them they then than there here which who its not but all any'.split(
    ' ',
  ),
);
/** Rough English stemming, enough for "refunds"/"refunded"/"refund". */
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, '');
const wordsOf = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map(stem),
  );
/** FAQ answers are Markdown; the chat shows plain text. */
const plain = (md: string) =>
  md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1200);

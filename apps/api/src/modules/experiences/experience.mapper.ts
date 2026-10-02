import type {
  AgentExperienceListItem,
  AgentExperienceView,
  CleaningDetailsView,
  EventDetailsView,
  ExperienceCard,
  HotelDetailsView,
  RoomView,
  TourDetailsView,
} from '@havenhub/shared';

import type {
  CleaningService,
  Event,
  EventTicketType,
  HotelRoom,
  HotelRoomType,
  ExperienceImage,
  ExperienceVideo,
  Tour,
  TourDate,
} from '../../generated/prisma/client';
import type { StorageService } from '../../infrastructure/storage/storage.service';
import { num, toImageView, toVideoView } from '../properties/property.mapper';
import { agentDisplayName } from '../properties/property.selects';
import { missingForSubmission } from './experience-lifecycle';
import type { AgentExperienceRow, ExperienceCardRow } from './experience.selects';

type Urls = Pick<StorageService, 'url'>;

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const minOf = (values: bigint[]) =>
  values.length ? Number(values.reduce((a, b) => (b < a ? b : a))) : null;

/** Experience media rows have the same shape as property media rows. */
export const toExperienceImageView = (image: ExperienceImage, urls: Urls) =>
  toImageView({ ...image, propertyId: image.experienceId }, urls);
export const toExperienceVideoView = (video: ExperienceVideo) =>
  toVideoView({ ...video, propertyId: video.experienceId });

export function toEventDetails(
  event: Event & { ticketTypes: EventTicketType[] },
): EventDetailsView {
  return {
    startsAt: iso(event.startsAt),
    endsAt: iso(event.endsAt),
    capacity: event.capacity,
    organizer: event.organizer,
    terms: event.terms,
    hospitality: event.hospitality,
    ticketTypes: event.ticketTypes.map((t) => ({
      id: t.id,
      kind: t.kind,
      name: t.name,
      description: t.description,
      priceKobo: Number(t.priceKobo),
    })),
  };
}

export function toTourDetails(tour: Tour & { dates: TourDate[] }): TourDetailsView {
  return {
    category: tour.category,
    priceKobo: num(tour.priceKobo),
    priceNote: tour.priceNote,
    capacity: tour.capacity,
    dates: tour.dates.map((d) => d.startsAt.toISOString()),
  };
}

export function toHotelDetails(hotel: {
  hospitality: string | null;
  food: string | null;
  cleaning: string | null;
  roomTypes: (HotelRoomType & { _count: { rooms: number } })[];
}): HotelDetailsView {
  return {
    hospitality: hotel.hospitality,
    food: hotel.food,
    cleaning: hotel.cleaning,
    roomTypes: hotel.roomTypes.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      maxGuests: t.maxGuests,
      priceKobo: Number(t.priceKobo),
      roomCount: t._count.rooms,
    })),
  };
}

export const toRoomView = (room: HotelRoom): RoomView => ({
  id: room.id,
  roomTypeId: room.roomTypeId,
  label: room.label,
  priceKobo: num(room.priceKobo),
  active: room.active,
});

export function toCleaningDetails(c: CleaningService): CleaningDetailsView {
  return {
    priceKobo: num(c.priceKobo),
    priceNote: c.priceNote,
    serviceAreas: c.serviceAreas,
    availableDays: c.availableDays,
    availabilityNote: c.availabilityNote,
  };
}

/** Only ever called for publicly visible rows. */
export function toExperienceCard(row: ExperienceCardRow, urls: Urls): ExperienceCard {
  const cover = row.images[0];
  let price: number | null = null;
  let priceNote: string | null = null;
  if (row.event) price = minOf(row.event.ticketTypes.map((t) => t.priceKobo));
  if (row.tour) [price, priceNote] = [num(row.tour.priceKobo), row.tour.priceNote];
  if (row.hotel) [price, priceNote] = [minOf(row.hotel.roomTypes.map((t) => t.priceKobo)), null];
  if (row.cleaning) [price, priceNote] = [num(row.cleaning.priceKobo), row.cleaning.priceNote];
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    title: row.title,
    city: row.city,
    state: row.state,
    coverImage: cover
      ? {
          url: urls.url(cover.storageKey),
          thumbnailUrl: urls.url(cover.thumbnailKey),
          altText: cover.altText,
        }
      : null,
    agent: {
      id: row.agentProfile.id,
      displayName: agentDisplayName(row.agentProfile),
      verified: true,
    },
    priceFromKobo: price,
    priceNote,
    startsAt: iso(row.event?.startsAt ?? row.tour?.dates[0]?.startsAt),
    endsAt: iso(row.event?.endsAt),
    category: row.tour?.category ?? null,
    serviceAreas: row.cleaning?.serviceAreas ?? [],
    publishedAt: row.publishedAt!.toISOString(),
  };
}

export function toAgentExperienceView(row: AgentExperienceRow, urls: Urls): AgentExperienceView {
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    status: row.status,
    moderationNote: row.moderationNote,
    submittedAt: iso(row.submittedAt),
    publishedAt: iso(row.publishedAt),
    title: row.title,
    description: row.description,
    addressLine: row.addressLine,
    city: row.city,
    state: row.state,
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    amenityIds: row.amenities.map((a) => a.amenityId),
    images: row.images.map((i) => toExperienceImageView(i, urls)),
    videos: row.videos.map(toExperienceVideoView),
    event: row.event ? toEventDetails(row.event) : null,
    tour: row.tour ? toTourDetails(row.tour) : null,
    hotel: row.hotel
      ? { ...toHotelDetails(row.hotel), rooms: row.hotel.rooms.map(toRoomView) }
      : null,
    cleaning: row.cleaning ? toCleaningDetails(row.cleaning) : null,
    missingForSubmission: missingForSubmission(submissionFacts(row)),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function submissionFacts(row: AgentExperienceRow) {
  return {
    kind: row.kind,
    description: row.description,
    addressLine: row.addressLine,
    city: row.city,
    state: row.state,
    imageCount: row.images.length,
    event: row.event,
    tour: row.tour,
    hotel: row.hotel ? { roomTypeCount: row.hotel.roomTypes.length } : null,
    cleaning: row.cleaning,
  };
}

export function toAgentExperienceListItem(
  row: {
    id: string;
    slug: string;
    kind: AgentExperienceListItem['kind'];
    title: string;
    status: AgentExperienceListItem['status'];
    moderationNote: string | null;
    city: string | null;
    state: string | null;
    updatedAt: Date;
    images: { thumbnailKey: string }[];
    event: { startsAt: Date | null } | null;
  },
  urls: Urls,
): AgentExperienceListItem {
  const cover = row.images[0];
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    title: row.title,
    status: row.status,
    moderationNote: row.moderationNote,
    city: row.city,
    state: row.state,
    startsAt: iso(row.event?.startsAt),
    coverImage: cover ? { thumbnailUrl: urls.url(cover.thumbnailKey) } : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

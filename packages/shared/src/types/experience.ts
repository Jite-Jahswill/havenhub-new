import type {
  ExperienceKind,
  ExperienceStatus,
  TicketTypeKind,
  TourCategory,
  Weekday,
} from '../enums/experience.js';
import type {
  AmenityView,
  ListingAgentView,
  PropertyImageView,
  PropertyVideoView,
} from './property.js';

/**
 * Events & experiences API shapes (Phase 6). All money is integer kobo and
 * is a *listed* price for display: nothing can be bought or booked yet.
 */

export type ExperienceImageView = PropertyImageView;
export type ExperienceVideoView = PropertyVideoView;

export interface TicketTypeView {
  id: string;
  kind: TicketTypeKind;
  name: string;
  description: string | null;
  priceKobo: number;
}

export interface EventDetailsView {
  startsAt: string | null;
  endsAt: string | null;
  capacity: number | null;
  organizer: string | null;
  terms: string | null;
  hospitality: string | null;
  ticketTypes: TicketTypeView[];
}

export interface TourDetailsView {
  category: TourCategory | null;
  priceKobo: number | null;
  priceNote: string | null;
  capacity: number | null;
  /** Upcoming start times (public) or every stored date (owner/admin). */
  dates: string[];
}

export interface RoomTypeView {
  id: string;
  name: string;
  description: string | null;
  maxGuests: number | null;
  /** Listed nightly price. */
  priceKobo: number;
  /** Active rooms of this type. */
  roomCount: number;
}

export interface RoomView {
  id: string;
  roomTypeId: string;
  label: string;
  /** Overrides the room type's nightly price; null = the type's price. */
  priceKobo: number | null;
  active: boolean;
}

export interface HotelDetailsView {
  hospitality: string | null;
  food: string | null;
  cleaning: string | null;
  roomTypes: RoomTypeView[];
}

export interface CleaningDetailsView {
  priceKobo: number | null;
  priceNote: string | null;
  serviceAreas: string[];
  availableDays: Weekday[];
  availabilityNote: string | null;
}

/** Compact public listing for cards. */
export interface ExperienceCard {
  id: string;
  slug: string;
  kind: ExperienceKind;
  title: string;
  city: string | null;
  state: string | null;
  coverImage: { url: string; thumbnailUrl: string; altText: string | null } | null;
  agent: { id: string; displayName: string; verified: true };
  /** Lowest listed price (ticket, tour, room type or service); null if none. */
  priceFromKobo: number | null;
  priceNote: string | null;
  /** Event start, or a tour's next date. */
  startsAt: string | null;
  endsAt: string | null;
  category: TourCategory | null;
  serviceAreas: string[];
  publishedAt: string;
}

export interface ExperienceSearchResult {
  items: ExperienceCard[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ExperienceDetail extends ExperienceCard {
  description: string | null;
  addressLine: string | null;
  latitude: number | null;
  longitude: number | null;
  images: ExperienceImageView[];
  videos: ExperienceVideoView[];
  amenities: AmenityView[];
  agent: ListingAgentView;
  event: EventDetailsView | null;
  tour: TourDetailsView | null;
  hotel: HotelDetailsView | null;
  cleaning: CleaningDetailsView | null;
  /** Always false in this release: purchasing and booking come later. */
  purchasable: false;
  updatedAt: string;
}

/** Public, aggregated hotel availability: rooms open per type and date. */
export interface HotelAvailabilityView {
  from: string;
  to: string;
  roomTypes: {
    roomTypeId: string;
    days: { date: string; availableRooms: number; minPriceKobo: number | null }[];
  }[];
}

/** The owning agent's full view, including moderation state. */
export interface AgentExperienceView {
  id: string;
  slug: string;
  kind: ExperienceKind;
  status: ExperienceStatus;
  moderationNote: string | null;
  submittedAt: string | null;
  publishedAt: string | null;
  title: string;
  description: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  amenityIds: string[];
  images: ExperienceImageView[];
  videos: ExperienceVideoView[];
  event: EventDetailsView | null;
  tour: TourDetailsView | null;
  hotel: (HotelDetailsView & { rooms: RoomView[] }) | null;
  cleaning: CleaningDetailsView | null;
  /** Fields still needed before the listing can be submitted for review. */
  missingForSubmission: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentExperienceListItem {
  id: string;
  slug: string;
  kind: ExperienceKind;
  title: string;
  status: ExperienceStatus;
  moderationNote: string | null;
  city: string | null;
  state: string | null;
  startsAt: string | null;
  coverImage: { thumbnailUrl: string } | null;
  updatedAt: string;
}

/** `limit` null = unlimited; the whole entry is null when the kind is not limited. */
export interface ExperienceAllowance {
  used: number;
  limit: number | null;
}

export interface AgentExperienceList {
  items: AgentExperienceListItem[];
  allowances: Record<ExperienceKind, ExperienceAllowance | null>;
}

export interface RoomAvailabilityView {
  from: string;
  to: string;
  rooms: {
    roomId: string;
    label: string;
    roomTypeId: string;
    active: boolean;
    /** Nightly price when there is no date override. */
    defaultPriceKobo: number;
    overrides: { date: string; available: boolean; priceKobo: number | null }[];
  }[];
}

export interface AdminExperienceListItem {
  id: string;
  slug: string;
  kind: ExperienceKind;
  title: string;
  status: ExperienceStatus;
  city: string | null;
  state: string | null;
  agent: { id: string; displayName: string; email: string };
  coverImage: { thumbnailUrl: string } | null;
  submittedAt: string | null;
  updatedAt: string;
}

export interface AdminExperienceDetail extends AgentExperienceView {
  agent: {
    id: string;
    userId: string;
    displayName: string;
    email: string;
    verificationStatus: string;
  };
  amenities: AmenityView[];
  reviewedAt: string | null;
}

// ── Vacation zones ──

export interface VacationZoneCard {
  id: string;
  slug: string;
  name: string;
  state: string | null;
  summary: string | null;
  coverImage: { url: string; thumbnailUrl: string } | null;
  priceRangeMinKobo: number | null;
  priceRangeMaxKobo: number | null;
}

export interface VacationZoneDetail extends VacationZoneCard {
  description: string | null;
  accommodation: string | null;
  activities: string[];
  offers: string | null;
  hospitality: string | null;
  nearbyAttractions: string[];
  /** Featured tours and hotels that are currently public. */
  experiences: ExperienceCard[];
}

export interface AdminVacationZoneView extends Omit<VacationZoneDetail, 'experiences'> {
  published: boolean;
  sortOrder: number;
  /** Every curated listing, public or not, so the admin sees what is hidden. */
  experiences: {
    id: string;
    slug: string;
    kind: ExperienceKind;
    title: string;
    status: ExperienceStatus;
    public: boolean;
  }[];
  createdAt: string;
  updatedAt: string;
}

export interface AdminVacationZoneListItem {
  id: string;
  slug: string;
  name: string;
  state: string | null;
  published: boolean;
  coverImage: { thumbnailUrl: string } | null;
  experienceCount: number;
  updatedAt: string;
}

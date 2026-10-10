import {
  ExperienceKind,
  ListingType,
  PricingPeriod,
  PropertyType,
  type AssistantIntent,
} from '@havenhub/shared';

/**
 * The assistant's language understanding: rule-based and deterministic (no
 * external AI). It turns a question into an intent plus the filters HavenHub's
 * own search already supports — price, place, bedrooms, type, period.
 */

export interface KnownPlaces {
  /** Nigerian states, as stored on listings ("Akwa Ibom", "FCT"…). */
  states: readonly string[];
  /** Cities that have published listings, with their state. */
  cities: readonly { city: string; state: string }[];
}

export interface PlaceMatch {
  city?: string;
  state?: string;
  /** As the user wrote it, for replies ("in Uyo"). */
  label: string;
}

export interface PropertyFilters {
  listingType?: ListingType;
  propertyType?: PropertyType[];
  pricingPeriod?: PricingPeriod[];
  minPriceKobo?: number;
  maxPriceKobo?: number;
  minBedrooms?: number;
  furnished?: true;
  onOffer?: true;
  place?: PlaceMatch;
  sort?: 'price_asc' | 'price_desc' | 'newest' | 'discount';
}

export interface ParsedQuestion {
  intent: AssistantIntent;
  property?: PropertyFilters;
  experience?: { kind: ExperienceKind; place?: PlaceMatch };
  bookingReference?: string;
  /** Lower-cased words worth matching against FAQs and help articles. */
  keywords: string[];
}

const has = (text: string, re: RegExp) => re.test(text);

const HANDOFF =
  /\b(humans?|real person|customer (care|service|support)|support (team|staff)|representative|live (chat|agent)|(talk|speak|chat) (to|with) (a |an |the |your )?(person|someone|somebody|support|staff|admin|team|customer care|agent)|call me)\b/;
const GREETING = /^(hi+|hello+|hey+|good (morning|afternoon|evening)|howdy|yo|greetings)\b/;
const THANKS = /\b(thanks?|thank you|thx|cheers|appreciate it|great,? thanks)\b/;
const CAPABILITIES =
  /\b(what can you do|how can you help|what do you do|who are you|help me|menu)\b/;
const REFUND = /\brefund(s|ed)?\b|\bmoney back\b/;
const STATUS_WORDS =
  /\b(my|status|where|when|track|check|has|have|did|yet|still|pending|update|progress)\b/;
const BOOKING = /\b(booking|bookings|reservation|reservations|my stay|my trip|check[- ]?in)\b/;
const PAYMENT = /\b(my payment|payment status|was i charged|did my payment|paid)\b/;
const REFERENCE = /\bhh-?([a-z0-9]{8})\b/i;

const EXPERIENCE_WORDS: [RegExp, ExperienceKind][] = [
  [/\b(tours?|tourist|sight-?seeing|excursions?|tourism|attractions?|tour locations?)\b/, 'TOUR'],
  [/\b(events?|concerts?|part(y|ies)|festivals?|tickets?)\b/, 'EVENT'],
  [/\b(hotels?|motels?|resorts?|guest ?houses?|inns?)\b/, 'HOTEL'],
  [/\b(clean(ing|ers?)?|janitorial|fumigation)\b/, 'CLEANING'],
];

const PROPERTY_TYPES: [RegExp, PropertyType][] = [
  [/\b(apartments?|flats?|mini ?flats?)\b/, 'APARTMENT'],
  [/\b(self[- ]?contain(ed)?|self[- ]?con|studios?|room and parlou?r)\b/, 'SELF_CONTAINED'],
  [/\b(duplex(es)?)\b/, 'DUPLEX'],
  [/\b(bungalows?)\b/, 'BUNGALOW'],
  [/\b(terraces?|terraced)\b/, 'TERRACE'],
  [/\b(penthouses?)\b/, 'PENTHOUSE'],
  [/\b(lands?|plots?|acres?)\b/, 'LAND'],
  [/\b(shops?|stores?)\b/, 'SHOP'],
  [/\b(offices?|office space)\b/, 'OFFICE'],
  [/\b(warehouses?)\b/, 'WAREHOUSE'],
  [/\b(houses?|homes?|mansions?)\b/, 'HOUSE'],
];
const PROPERTY_WORDS =
  /\b(propert(y|ies)|listings?|real estate|rent|rentals?|to let|lease|buy|purchase|for sale|sale|shortlets?|short[- ]let|accommodations?|place to stay|bedrooms?|beds?|cheap|affordable)\b/;

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const STOP_WORDS = new Set(
  'a an the is are was were be been i me my we our you your it its of in on at to for from with and or but how what when where why who which can could do does did should would will shall there their this that these those about any some please tell know want need get have has had not no yes just like also than then so if hi hello hey'.split(
    ' ',
  ),
);

export function parseQuestion(raw: string, places: KnownPlaces): ParsedQuestion {
  const text = normalise(raw);
  const keywords = text
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    .slice(0, 20);
  const base = { keywords };

  if (has(text, HANDOFF)) return { ...base, intent: 'HANDOFF' };

  const ref = REFERENCE.exec(raw);
  if (ref)
    return { ...base, intent: 'BOOKING_STATUS', bookingReference: `HH-${ref[1]!.toUpperCase()}` };
  if (has(text, REFUND) && has(text, STATUS_WORDS)) return { ...base, intent: 'REFUND_STATUS' };
  if (
    (has(text, BOOKING) && has(text, /\b(my|status|where|when|upcoming|confirmed|check)\b/)) ||
    has(text, PAYMENT)
  ) {
    return { ...base, intent: 'BOOKING_STATUS' };
  }

  const place = findPlace(text, places);
  const kind = EXPERIENCE_WORDS.find(([re]) => re.test(text))?.[1];
  const propertyType = PROPERTY_TYPES.filter(([re]) => re.test(text)).map(([, t]) => t);
  const price = parsePrice(text);
  const bedrooms = parseBedrooms(text);
  // A hotel or tour question wins over generic property words ("hotel to stay in Uyo"),
  // unless a property type is named ("apartment near a hotel").
  if (kind && propertyType.length === 0) {
    return {
      ...base,
      intent: 'EXPERIENCE_SEARCH',
      experience: { kind, ...(place ? { place } : {}) },
    };
  }
  if (
    propertyType.length > 0 ||
    price ||
    bedrooms !== undefined ||
    has(text, PROPERTY_WORDS) ||
    (place && has(text, /\b(in|at|around|near)\b/) && !has(text, REFUND))
  ) {
    return {
      ...base,
      intent: 'PROPERTY_SEARCH',
      property: {
        ...listingFilters(text),
        ...(propertyType.length ? { propertyType: [...new Set(propertyType)] } : {}),
        ...(price ?? {}),
        ...(bedrooms !== undefined ? { minBedrooms: bedrooms } : {}),
        ...(has(text, /\bfurnished\b/) && !has(text, /\bun-?furnished\b/)
          ? { furnished: true as const }
          : {}),
        ...(has(text, /\b(discounts?|discounted|deals?|offers?|promos?)\b/)
          ? { onOffer: true as const }
          : {}),
        ...(place ? { place } : {}),
        ...sortFor(text, price),
      },
    };
  }

  if (has(text, REFUND)) return { ...base, intent: 'FAQ' };
  const short = text.split(' ').length <= 6;
  if (short && has(text, THANKS)) return { ...base, intent: 'THANKS' };
  if (has(text, CAPABILITIES)) return { ...base, intent: 'CAPABILITIES' };
  if (short && has(text, GREETING)) return { ...base, intent: 'GREETING' };
  return { ...base, intent: 'FAQ' };
}

function normalise(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}₦.,\-+<> ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function listingFilters(text: string): Pick<PropertyFilters, 'listingType' | 'pricingPeriod'> {
  const out: Pick<PropertyFilters, 'listingType' | 'pricingPeriod'> = {};
  if (has(text, /\b(buy|purchase|for sale|on sale|sell(ing)?)\b/)) out.listingType = 'SALE';
  else if (
    has(
      text,
      /\b(rent|rentals?|to let|lease|shortlets?|short[- ]let|per (night|month|year)|nightly|monthly|yearly|annual(ly)?|per annum)\b/,
    )
  ) {
    out.listingType = 'RENT';
  }
  if (out.listingType !== 'SALE') {
    const periods: PricingPeriod[] = [];
    if (has(text, /\b(shortlets?|short[- ]let|per night|a night|nightly|daily|per day|weekend)\b/))
      periods.push('DAILY');
    if (has(text, /\b(monthly|per month|a month|\/month)\b/)) periods.push('MONTHLY');
    if (has(text, /\b(yearly|per year|a year|annual(ly)?|per annum|\/year|p\.?a\.?)\b/))
      periods.push('YEARLY');
    if (periods.length) {
      out.pricingPeriod = periods;
      out.listingType = 'RENT';
    }
  }
  return out;
}

function sortFor(
  text: string,
  price: Pick<PropertyFilters, 'minPriceKobo' | 'maxPriceKobo'> | null,
): Pick<PropertyFilters, 'sort'> {
  if (has(text, /\b(cheapest|lowest price|least expensive|most affordable)\b/))
    return { sort: 'price_asc' };
  if (has(text, /\b(most expensive|luxury|luxurious|highest price|premium)\b/))
    return { sort: 'price_desc' };
  if (has(text, /\b(best deals?|biggest discount)\b/)) return { sort: 'discount' };
  if (price?.maxPriceKobo !== undefined && price.minPriceKobo === undefined)
    return { sort: 'price_desc' };
  if (has(text, /\b(cheap|affordable|budget)\b/)) return { sort: 'price_asc' };
  return {};
}

const AMOUNT = String.raw`(?:₦|ngn|n)?\s?(\d+(?:[.,]\d+)*)\s?(k|m|mil|million|millions|thousand|b|bn|billion)?\b`;

/** Naira amount in words or digits ("100k", "1.5m", "₦250,000", "2 million") → kobo. */
export function amountToKobo(digits: string, unit: string | undefined): number | null {
  const n = Number(digits.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const multiplier = !unit
    ? 1
    : unit === 'k' || unit === 'thousand'
      ? 1_000
      : unit === 'b' || unit === 'bn' || unit === 'billion'
        ? 1_000_000_000
        : 1_000_000;
  const naira = n * multiplier;
  return naira > 0 && naira <= 100_000_000_000 ? Math.round(naira * 100) : null;
}

/** A plain number counts as money only with ₦/a unit or when it is clearly a price (≥ 1,000). */
function moneyAt(match: RegExpExecArray, i = 1): number | null {
  const digits = match[i]!;
  const unit = match[i + 1];
  const explicit = Boolean(unit) || /₦|ngn|\bn\d/.test(match[0]);
  if (!explicit && Number(digits.replace(/,/g, '')) < 1_000) return null;
  return amountToKobo(digits, unit);
}

export function parsePrice(
  text: string,
): Pick<PropertyFilters, 'minPriceKobo' | 'maxPriceKobo'> | null {
  const between =
    new RegExp(String.raw`\bbetween\s+${AMOUNT}\s+(?:and|to|-)\s+${AMOUNT}`).exec(text) ??
    new RegExp(String.raw`${AMOUNT}\s?(?:-|to)\s?${AMOUNT}`).exec(text);
  if (between) {
    const low = moneyAt(between, 1);
    const high = moneyAt(between, 3) ?? null;
    // "100-200k": the unit on the second number applies to both.
    const lowKobo = low ?? (between[4] ? amountToKobo(between[1]!, between[4]) : null);
    if (lowKobo !== null && high !== null && lowKobo <= high) {
      return { minPriceKobo: lowKobo, maxPriceKobo: high };
    }
  }
  const max = new RegExp(
    String.raw`\b(?:below|under|less than|cheaper than|not more than|no more than|max(?:imum)?|up to|within|at most|budget(?: of| is)?)\s*${AMOUNT}`,
  ).exec(text);
  if (max) {
    const kobo = moneyAt(max);
    if (kobo !== null) return { maxPriceKobo: kobo };
  }
  const min = new RegExp(
    String.raw`\b(?:above|over|more than|at least|min(?:imum)?|from|starting at)\s*${AMOUNT}`,
  ).exec(text);
  if (min) {
    const kobo = moneyAt(min);
    if (kobo !== null) return { minPriceKobo: kobo };
  }
  const around = new RegExp(
    String.raw`\b(?:around|about|roughly|approximately|for)\s*${AMOUNT}`,
  ).exec(text);
  if (around) {
    const kobo = moneyAt(around);
    if (kobo !== null) {
      return { minPriceKobo: Math.round(kobo * 0.8), maxPriceKobo: Math.round(kobo * 1.2) };
    }
  }
  // A bare amount with a unit ("2 bedroom flat 500k Lekki") reads as a budget.
  const bare =
    new RegExp(
      String.raw`(?:^|\s)(?:₦|ngn)?\s?(\d+(?:[.,]\d+)*)\s?(k|m|mil|million|thousand|b|bn|billion)\b`,
    ).exec(text) ?? /(?:^|\s)₦\s?(\d+(?:[.,]\d+)*)()/.exec(text);
  if (bare) {
    const kobo = amountToKobo(bare[1]!, bare[2] || undefined);
    if (kobo !== null) return { maxPriceKobo: kobo };
  }
  return null;
}

export function parseBedrooms(text: string): number | undefined {
  const m =
    /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s?-?\s?(bed(room)?s?|br|bdr|bd)\b/.exec(
      text,
    );
  if (!m) return undefined;
  const n = NUMBER_WORDS[m[1]!] ?? Number(m[1]);
  return n >= 1 && n <= 50 ? n : undefined;
}

/**
 * Well-known cities and areas, so "tours in Uyo" works before Uyo has a
 * listing (the search then falls back to the state). Cities with published
 * listings come from the database and take precedence.
 */
export const KNOWN_CITIES: readonly { city: string; state: string }[] = [
  ...[
    'Lagos',
    'Ikeja',
    'Lekki',
    'Victoria Island',
    'Ikoyi',
    'Ajah',
    'Yaba',
    'Surulere',
    'Gbagada',
    'Magodo',
    'Festac',
    'Epe',
    'Badagry',
  ].map((city) => ({ city, state: 'Lagos' })),
  ...['Maitama', 'Wuse', 'Garki', 'Asokoro', 'Gwarinpa', 'Jabi', 'Kubwa', 'Lugbe'].map((city) => ({
    city,
    state: 'FCT',
  })),
  { city: 'Port Harcourt', state: 'Rivers' },
  { city: 'Ibadan', state: 'Oyo' },
  { city: 'Kano', state: 'Kano' },
  { city: 'Kaduna', state: 'Kaduna' },
  { city: 'Enugu', state: 'Enugu' },
  { city: 'Benin City', state: 'Edo' },
  { city: 'Uyo', state: 'Akwa Ibom' },
  { city: 'Eket', state: 'Akwa Ibom' },
  { city: 'Ikot Ekpene', state: 'Akwa Ibom' },
  { city: 'Calabar', state: 'Cross River' },
  { city: 'Owerri', state: 'Imo' },
  { city: 'Abeokuta', state: 'Ogun' },
  { city: 'Jos', state: 'Plateau' },
  { city: 'Warri', state: 'Delta' },
  { city: 'Asaba', state: 'Delta' },
  { city: 'Ilorin', state: 'Kwara' },
  { city: 'Akure', state: 'Ondo' },
  { city: 'Onitsha', state: 'Anambra' },
  { city: 'Awka', state: 'Anambra' },
  { city: 'Abakaliki', state: 'Ebonyi' },
  { city: 'Umuahia', state: 'Abia' },
  { city: 'Aba', state: 'Abia' },
  { city: 'Yenagoa', state: 'Bayelsa' },
  { city: 'Osogbo', state: 'Osun' },
  { city: 'Ado Ekiti', state: 'Ekiti' },
  { city: 'Lokoja', state: 'Kogi' },
  { city: 'Makurdi', state: 'Benue' },
  { city: 'Minna', state: 'Niger' },
  { city: 'Sokoto', state: 'Sokoto' },
  { city: 'Maiduguri', state: 'Borno' },
  { city: 'Bauchi', state: 'Bauchi' },
  { city: 'Yola', state: 'Adamawa' },
];

/** Longest names first, so "Port Harcourt" wins over "Port" and "Akwa Ibom" over "Ibom". */
export function findPlace(text: string, places: KnownPlaces): PlaceMatch | undefined {
  const word = (name: string) =>
    new RegExp(String.raw`(^|[^a-z])${escapeRe(name.toLowerCase())}($|[^a-z])`);
  const known = new Set(places.cities.map((c) => c.city.toLowerCase()));
  const cities = [
    ...places.cities,
    ...KNOWN_CITIES.filter((c) => !known.has(c.city.toLowerCase())),
  ].sort((a, b) => b.city.length - a.city.length);
  for (const c of cities) {
    if (!word(c.city).test(text)) continue;
    // "Lagos", "Kano"…: the state, so every area in it is included.
    if (c.city.toLowerCase() === c.state.toLowerCase()) return { state: c.state, label: c.city };
    return { city: c.city, state: c.state, label: c.city };
  }
  if (/\babuja\b/.test(text)) {
    const fct = places.states.find((s) => /^(fct|federal capital territory)$/i.test(s));
    if (fct) return { state: fct, label: 'Abuja' };
  }
  const states = [...places.states].sort((a, b) => b.length - a.length);
  for (const s of states) {
    if (word(s).test(text)) return { state: s, label: s };
  }
  return undefined;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

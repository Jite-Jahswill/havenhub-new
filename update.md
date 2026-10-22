# HavenHub update — 17–18 October 2026

What changed in the app, who it affects, and what to do before deploying.

## Before you deploy

1. **Run the database migrations** (`pnpm db:deploy`). Five are new:
   - `20261017120000_experience_bookings`: package items, online booking switch, experience bookings, direct agent chats
   - `20261017130000_booking_hotel_rooms`: hotel bookings hold specific rooms
   - `20261017140000_agent_conversations`: allows the new direct-message chat type
   - `20261018090000_experience_promos_cleaning`: promo codes on experiences; cleaning bookings per day
   - `20261018100000_experience_reviews`: reviews of tour, event, hotel and cleaning bookings
2. **Set the Google Maps key** on the web app: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. In Google Cloud, enable the _Maps JavaScript API_ and _Maps Embed API_ and restrict the key to your domains. `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` is optional.
   - A production build needs this key. MapLibre, Mapbox and OpenStreetMap are gone: every map is Google Maps, and `NEXT_PUBLIC_MAPBOX_TOKEN` can be deleted.
3. **Make sure pricing rates are saved** in Admin → Payments → Rates. Without saved rates, every online booking (rentals and experiences) shows "Online booking is not open yet."
4. **Install dependencies** (`pnpm install`). The web app has one new dev dependency, `@types/google.maps`, and no longer depends on `maplibre-gl`.

## Changes needed for the app (setup checklist)

| What                                        | Where                                            | Needed for                                                                                                              |
| ------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 5 new database migrations                   | `pnpm db:deploy` (all environments)              | Experience bookings, hotel rooms, direct agent chats, promo codes on experiences, cleaning bookings, experience reviews |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`           | Web app env (`apps/web/.env.local`, hosting env) | Google Maps on the explore page. Location maps work without it.                                                         |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` (optional) | Web app env                                      | Your own map style for map pins; defaults to Google's demo ID                                                           |
| `NEXT_PUBLIC_MAPBOX_TOKEN`                  | Web app env                                      | No longer used; delete it. A production build needs the Google key.                                                     |
| Pricing rates                               | Admin → Payments → Rates                         | Any online booking: rentals, tours, events, hotels, cleaning                                                            |
| `pnpm install`                              | Repo root                                        | New `@types/google.maps` dev dependency                                                                                 |

No API environment variables changed. Paystack setup is unchanged; experience bookings use the same keys and webhook.

### Your local Docker database

- **It has been migrated** (container `havenhub-postgres-1`, port 5433, database `havenhub_dev`). Your existing data was kept, and the schema now matches the code.
- **It was originally created with `prisma db push`, so it had no migration history.**
  - I recorded the 21 older migrations as already applied (the schema already matched them) and applied the 5 new ones.
  - From now on, `pnpm db:deploy` works normally.
- **Some older integrity rules are not in it yet.** `db push` doesn't create the hand-written ones:
  - the database-level guard against double-booking a property;
  - CHECK constraints on amounts;
  - the append-only triggers on the ledger and audit log.
  - The app enforces these rules in code as well, so testing works. To get the full set, recreate the database from migrations: drop `havenhub_dev`, run `pnpm db:deploy`, then `pnpm db:seed`. This deletes its data, so run it yourself if you want it. A backup is in the session scratchpad.
- **No pricing rates are saved in it.** That is why bookings showed "coming soon". Save rates in Admin → Payments → Rates.
- **Keep the Homebrew Postgres stopped** if it's installed. It also uses port 5433 and takes over `localhost`, so the app would quietly use it instead of Docker. Check with `lsof -nP -iTCP:5433 -sTCP:LISTEN`: only Docker should be listed.

## Payments: what HavenHub collects

- **Rentals** (per night, per month, per year): paid on HavenHub with Paystack, unchanged.
- **Tours, events, hotels and cleaning**: new, also paid on HavenHub with Paystack (see below).
- **Property sales**: never paid on HavenHub. Sale listings show the agent card and contact details instead.

Every online payment uses the same Paystack checkout, ledger, refund and agent-earnings flow. The same admin rates apply (service fee, VAT, agent commission).

## New: book and pay for tours, events, hotels and cleaning

Everything is priced **per day** (per night for hotels). Guests choose:

- a start date and how many days or nights;
- how many people (tours and events) or rooms and guests (hotels);
- the **full package**, or **only the items they want**.

| Listing  | What guests pay for                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Tour     | Package items, e.g. tour fee, food, a place to stay, transport. Each is priced per day, per person or per group.             |
| Event    | The chosen ticket, per person for each day they attend, plus any extras. Guests can only pick days within the event's dates. |
| Hotel    | The chosen room type for each night, plus any extras (meals, airport pickup…).                                               |
| Cleaning | The cleaner's price for each day booked, plus any extras (deep clean, ironing…). Only on the days the cleaner works.         |

How it works for guests:

1. On the listing page, choose dates, people or rooms, and items. The price is worked out by the server and shown line by line.
2. Press **Book**. The places or rooms are held while they pay.
3. Pay with Paystack from the booking page, exactly like a rental.
4. The booking appears under **My bookings**, with what was included (full package or chosen items, ticket, room type).

Limits and safety:

- **Tours and events:** the listing's capacity is checked for every day of the booking. If a day is full, guests see how many places are left.
- **Tours that list run dates** can only start on those dates.
- **Hotels:** each booking holds actual rooms. Rooms closed on a date are skipped, and per-room and per-date prices are charged exactly. Two guests can never get the same room for the same night.
- **The listing's "X% off" discount** applies to online bookings.
- **If the price changes** between the quote and booking, the booking is refused and the guest sees the new total.
- **Free tickets** have nothing to pay. Guests are asked to message the organiser instead.
- **Agents' promo codes** work on all of these (see below).

### Cleaning: find a cleaner, pick a day, pay

1. **Search the cleaning page by area,** e.g. "Ughelli". Cleaners are found by the areas they cover, not only the city they're based in. The city filter works the same way.
2. **On the cleaner's page,** choose a date (only days they work), how many days, the area, and the address to clean. Add any extras.
3. **Book and pay with Paystack.** The address and area are shown to the cleaner on the booking.
4. **Message the cleaner** from the listing or the booking at any time.

Cleaners can set **"Bookings a day"** to cap how many online bookings they take on one day. Leave it empty for no limit.

### For agents

- **New section on tour, event, hotel and cleaning pages: "Online booking".**
  - Switch on **Accept online bookings and payment**.
  - Add package items. Each has a category (tour/entry fee, place to stay, food, transport, other), a name, a price per day, and whether it is charged per person.
- **What a listing needs before guests can book it:**
  - Tours: at least one package item.
  - Events: a ticket type or a package item.
  - Hotels: a room type with at least one room.
  - Cleaning: a price, or at least one package item.
- **Changing package items or the switch on a live listing sends it back for review,** like other price changes.
- **Agents get paid the same way as for rentals.** Bookings appear under Bookings and Earnings; the agent's share is the total minus HavenHub's commission.
- **A hotel room that has been booked can't be deleted.** Mark it inactive instead.

## New: promo codes on tours, events, hotels and cleaning

- **Agents' promo codes now work on all their listings:** rentals, tours, events, hotels and cleaning.
- **When creating a code,** leave everything unticked to cover all your listings, or tick the properties and listings it should apply to.
- **The code comes off the price after the listing's "X% off".** The agent funds it, as with rentals.
- **A use is held while the booking is unpaid,** used once it's paid, and given back if the booking expires or is cancelled.
- **Customers enter the code in the booking box** and see it applied in the price breakdown.

## New: reviews of tour, event, hotel and cleaning bookings

- **Customers can review any completed booking,** not just rental stays, within the same review window.
- **Listing pages show the star rating** under the title and a Reviews section, with paging.
- **Admin → Reviews lists all reviews with a link to the listing.** Hiding a review removes it from the rating.

## New: message an agent directly

- **Agent profile pages have a "Message agent" button.** Customers can write to any verified agent without picking a listing or making a booking.
- **Customers can also message an agent from any rental listing** without booking it.
- **Sale listings show "Message the agent" right under the agent card,** next to the phone and email.
- **Agents can't start conversations with customers** (unchanged).

## Earlier fixes in this round (from bugs.md)

- **Sale listings**: the sidebar shows the agent card, their phone and email (for signed-in visitors), and the off-platform disclaimer.
- **Map jumping after "Send for review"**: when a listing goes into review and the upload controls disappear, the page now stays where you were.
- **Search button moving on hover** (explore page and homepage) is fixed.
- **Google Maps**:
  - Listing pages, admin review and the agent form preview use Google Maps, with an "Open in Google Maps" link.
  - The explore page results map uses Google Maps once the API key is set.
- **Coordinates from latlong.net**: agents now type latitude and longitude instead of clicking a map.
  - The form explains, step by step, how to get the numbers from latlong.net and shows a Google Maps preview.
  - Pasting "6.43, 3.42" fills both boxes.
  - The form warns if the point is outside Nigeria.
- **Homepage**: a new card under the search reads "HavenHub is here to make life easier…" and opens the assistant. The assistant's greeting now invites guests to describe what they want and their budget.
- **Agent profile pages** no longer say messaging is "coming soon".

## For developers

- **New API endpoints:**
  - `POST /bookings/experience/quote`: public, read-only price quote.
  - `POST /bookings/experience`: a customer creates a booking.
  - `PUT /agents/me/experiences/:id/package-items`: an agent replaces their package items.
  - `GET /experiences/:slug/reviews`: published reviews of a tour, event, hotel or cleaning service.
- **Experience bookings** accept `code` (promo), and for cleaning `serviceArea` and `address` (the address is required when booking, not for a quote).
- **Promo codes** take `experienceIds` alongside `propertyIds`.
- **Reviews** have `experienceId` or `propertyId` (database check). The admin review view has `listing` instead of `property`.
- **Chat:** `POST /conversations` accepts `{ contextType: 'AGENT', agentId }`.
- **`Booking` now covers rentals and experiences:**
  - Exactly one of `propertyId` / `experienceId` is set (database check).
  - Experience bookings store what was chosen in `selection` and the held rooms in `booking_hotel_rooms`.
  - `propertySnapshot` holds a `kind` for experiences.
  - Booking views now include `property.kind`, `property.href` and `selection`.
- **Public experience detail:** `purchasable` is replaced by `bookable`, `packageItems` and `rating`.
- **Tests:**
  - New `apps/api/test/experience-bookings.e2e-spec.ts` covers pricing, capacity, hotel rooms, event days, opt-in rules, payment and ledger, direct agent chats, cleaning (area search, work days, address, daily limit), promo codes and experience reviews.
  - New unit tests cover `priceExperience`.

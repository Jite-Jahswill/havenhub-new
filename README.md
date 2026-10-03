# HavenHub

Nigeria's marketplace for places to live, stay, buy, visit, work and celebrate: rentals, short stays,
property and land sales, hotels, events, tours, vacation zones and cleaning services.

The full product specification lives in [`HAVENHUB_SPEC.md`](./HAVENHUB_SPEC.md).

> **Status:** Phase 2 (property marketplace) complete. Agents create listings with photos, video
> links and admin-managed amenities, and submit them for moderation. Customers search with filters and
> a map, view listing pages and save favourites. Admins moderate listings and manage amenities.
> Phase 3 (booking & payments) is next.

## Architecture

```
havenhub/
├── apps/
│   ├── web/          Next.js 16 (App Router) · React 19 · Tailwind CSS 4      → Vercel
│   └── api/          NestJS 12 REST API · Prisma 7 · ioredis                  → Railway
├── packages/
│   ├── shared/       Framework-agnostic types, enums, Zod schemas, money helpers
│   └── ui/           Design tokens (light/dark) + reusable React components
├── prisma/           schema.prisma + migrations (client is generated into apps/api)
├── prisma.config.ts  Prisma CLI configuration
└── docker-compose.yml  Local PostgreSQL 18 + Redis 8
```

**Principles**

- **The API is the product.** All business rules, pricing and authorization live in `apps/api`,
  so the web app and the future Flutter app consume the same versioned REST API
  (`/api/v1/...`). The web app holds no business logic.
- **Shared contracts.** Request/response shapes are Zod schemas in `@havenhub/shared`, used by the
  API for validation and by the web app for typing.
- **Consistent errors.** Every API error has the shape
  `{ "success": false, "message": "...", "code": "SOME_CODE" }`. Stack traces never reach clients.
- **Money is integer kobo.** Never floats and never naira in storage. The API calculates final totals.
- **Design tokens, not hex codes.** Components use semantic tokens (`bg-primary`, `text-text-secondary`,
  `bg-surface-secondary`…) defined in `packages/ui/src/styles/tokens.css`, with a separately tuned
  dark palette. Light, dark and system themes are supported via `<html data-theme>`.
- **Portable infrastructure.** Configuration comes only from environment variables. Nothing assumes
  Vercel or Railway, and storage will target the S3 API.

### API layout (`apps/api/src`)

| Path              | Purpose                                                                     |
| ----------------- | --------------------------------------------------------------------------- |
| `config/`         | Zod-validated environment; the process refuses to boot if it is invalid     |
| `infrastructure/` | Prisma, Redis, field encryption, email transports (global modules)          |
| `common/`         | Errors, Zod validation pipe, rate limiting, response helpers                |
| `modules/`        | One module per domain: `auth`, `users`, `agents`, `admin`, `rbac`, `audit`… |
| `scripts/`        | Operational scripts: RBAC seed, create-admin                                |
| `setup-app.ts`    | Prefix, versioning, CORS, Helmet, cookies, body limits, error filter        |

### Endpoints

| Method | Path               | Description                                                       |
| ------ | ------------------ | ----------------------------------------------------------------- |
| GET    | `/api/health/live` | Liveness: the process is running                                  |
| GET    | `/api/health`      | Readiness: PostgreSQL + Redis status; returns `503` when degraded |

## Authentication & authorization

One session system serves both client types; only the token transport differs.

| Client        | Login                                  | Each request                          | Refresh                                 |
| ------------- | -------------------------------------- | ------------------------------------- | --------------------------------------- |
| Web (default) | `POST /auth/login` → HttpOnly cookies  | `hh_at` cookie + `X-CSRF-Token`       | `hh_rt` cookie (the web proxy does it)  |
| Flutter / API | same, with header `X-Auth-Mode: token` | `Authorization: Bearer <accessToken>` | `POST /auth/refresh` `{ refreshToken }` |

- **Sessions** are database rows. Tokens are `<sessionId>.<secret>`; only SHA-256 hashes are stored.
  Access tokens last 15 minutes, refresh tokens 30 days, and **refresh tokens rotate on every use**.
  Reusing an old refresh token revokes the session (theft detection). Logout, password changes,
  password resets and account blocks revoke sessions immediately.
- **Web cookies** are `HttpOnly`, `SameSite=Lax` and `Secure` in production. Tokens are never exposed to
  JavaScript or `localStorage`. The browser only talks to the web app's own origin: Next.js
  forwards `/api/*` to the API, so cookies are first-party wherever the API is hosted.
- **CSRF**: cookie-authenticated mutations need `X-CSRF-Token`, an HMAC of the session id held in
  the readable `hh_csrf` cookie, plus an allowed `Origin`. Bearer requests are exempt.
- **Passwords**: Argon2id (19 MiB, t=2). Login, registration and password reset don't reveal whether an
  email is registered.
- **Email verification** is required to sign in (`REQUIRE_EMAIL_VERIFICATION`). Sensitive
  actions — identity, payout, admin — always require a verified email.
- **Authorization** is enforced only by the API, through global guards in this order: rate limit → authenticate →
  CSRF → authorize (`@AccountTypes`, `@RequirePermissions`, `@RequireVerifiedEmail`). Every route
  is authenticated unless marked `@Public()`.
- **RBAC**: `Role`, `Permission`, `RolePermission` and `UserRole` tables. The permission catalogue lives in
  `packages/shared/src/rbac/permissions.ts`; system roles live in `apps/api/src/modules/rbac/system-roles.ts`.
  Only ADMIN accounts can hold permissions, and they are re-read on every request. Nobody can
  change their own roles or grant permissions they don't hold.
- **Admins** can't be created through public registration. Bootstrap the first one with
  `pnpm admin:create`.
- **Sensitive data**: NIN and bank account numbers are AES-256-GCM encrypted at rest
  (`FIELD_ENCRYPTION_KEY`) and only ever returned masked (`•••••••1234`). Public agent profiles
  contain no contact, identity or bank data.

### API routes (`/api/v1`)

| Area   | Routes                                                                                                                                                                                                                                                                                                     |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth   | `POST auth/register/customer`, `auth/register/agent`, `auth/login`, `auth/refresh`, `auth/logout`, `auth/logout-all`, `auth/verify-email`, `auth/resend-verification`, `auth/forgot-password`, `auth/reset-password`, `auth/change-password` · `GET auth/me`, `auth/sessions` · `DELETE auth/sessions/:id` |
| Users  | `GET / PATCH users/me`                                                                                                                                                                                                                                                                                     |
| Agents | `GET / PATCH agents/me` · `PUT agents/me/identity`, `agents/me/payout-account` · `POST agents/me/verification`, `agents/me/onboarding/{dismiss,restore}` · `GET agents/me/onboarding`, `agents/me/plan` · `GET agents/:id` (public, verified agents only)                                                  |
| Admin  | `GET admin/overview`, `admin/users`, `admin/users/:id`, `admin/agents`, `admin/agents/:id`, `admin/rbac/roles`, `admin/rbac/permissions`, `admin/audit-logs` · `PATCH admin/users/:id/status`, `admin/agents/:id/verification` · `PUT admin/users/:id/roles`                                               |

## Property marketplace (Phase 2)

- **Lifecycle** (one status that includes moderation): `DRAFT → PENDING_REVIEW → PUBLISHED`, with
  `REJECTED` (a note is required, then the agent edits and resubmits), `SUSPENDED` (admin) and
  `ARCHIVED` (agent). Editing a published listing, or adding media to it, sends it back to review.
- **Public visibility** is defined in one place (`PUBLIC_PROPERTY_WHERE`): published **and** owned by a
  verified agent with an active account. Suspending an agent hides all of their listings immediately.
- **Ownership:** agent routes (`/agents/me/properties/...`) never take an agent id. Another agent's
  property or media id answers 404, and ownership can't be injected through the request body.
- **Plan limits** (`PlanLimitsService`): Free plan = 1 active property (archived listings don't count),
  10 photos and 1 video per listing. Limits are checked inside a transaction that locks the owning row,
  so concurrent requests can't exceed them. Phase 4 replaces the constants with database-managed plans.
- **Media:**
  - Uploads are decoded and re-encoded with sharp into two WebP renditions; EXIF/GPS data is
    stripped, and the file type comes from decoding, never from the name.
  - Only storage keys are stored; URLs are derived at read time.
  - Storage goes through a driver interface: local disk in development, any S3-compatible service in
    production.
  - Videos are YouTube or Vimeo links; only the provider and id are stored, and embeds are rebuilt
    from them.
- **Search** (`GET /properties`): free text, state/city, type, rent/sale, pricing period, price range,
  bedrooms, bathrooms, guests, furnished, cleaning included, amenities (all must match), map bounding
  box, sort and pagination. Every filter maps to a real column.
- **Maps:** MapLibre GL with a provider-agnostic tile config. Set `NEXT_PUBLIC_MAPBOX_TOKEN` for Mapbox
  tiles (required in production); without it, OpenStreetMap tiles are used for development. MapLibre's
  web worker is copied into `apps/web/public/vendor` before `dev` and `build`.
- **Money** is integer kobo; prices use `BigInt` columns because sale prices exceed 32-bit kobo.

| Area     | Routes (`/api/v1`)                                                                                                                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public   | `GET properties`, `properties/:slug`, `properties/:slug/similar`, `amenities`, `agents/:id` · `POST properties/:id/views` · `GET /api/media/*` (local storage only)                                                                                                                         |
| Agent    | `GET/POST agents/me/properties` · `GET/PATCH agents/me/properties/:id` · `POST …/:id/{submit,withdraw,archive,restore}` · `POST …/:id/images` · `PATCH …/:id/images/order`, `…/:id/images/:imageId` · `DELETE …/:id/images/:imageId` · `POST …/:id/videos` · `DELETE …/:id/videos/:videoId` |
| Customer | `GET favorites` · `PUT/DELETE favorites/:propertyId` · `POST/DELETE users/me/avatar`                                                                                                                                                                                                        |
| Admin    | `GET admin/properties`, `admin/properties/:id` · `PATCH admin/properties/:id/moderation` · `GET/POST admin/amenities` · `PATCH admin/amenities/:id`                                                                                                                                         |

## Bookings & payments (Phase 3)

- **Bookings** cover rentals only (daily, monthly, yearly); sale listings are refused. A booking is
  `AWAITING_PAYMENT → CONFIRMED → COMPLETED`, or `CANCELLED` / `EXPIRED`. Every transition goes
  through one table (`booking-lifecycle.ts`) under a row lock; final states never change.
- **Availability:** stays are half-open date ranges. Creation locks the property row, and a
  PostgreSQL exclusion constraint (`bookings_no_overlap`, `btree_gist`) makes overlapping holds
  impossible even for concurrent requests. Unpaid bookings hold dates for `BOOKING_HOLD_MINUTES`.
- **Pricing** (`pricing-engine.ts`) is pure integer-kobo `bigint` arithmetic: rent − listing discount
  = stay; + cleaning (if selected) + caution deposit + HavenHub service fee + VAT = total. The agent
  receives stay − commission + cleaning. Service fee, commission and VAT rates are **admin-configured**
  (`/admin/payments` → Commission & VAT); each save is a new version, and bookings stay closed until
  one exists. Every booking freezes its lines, amounts, rates version and a property snapshot.
  **Production rates are not approved yet.** The 10% service fee, 5% commission and 7.5% VAT on the
  fee used by tests and local QA (`apps/api/test/fixtures/qa-pricing-rates.ts`) are development/QA
  values only; the code has no default rates, and production must be configured by an administrator.
- **Payments** go through a `PaymentProvider` interface (Paystack, or the development test provider).
  Only server-side verification settles a payment, checked against our reference, amount and currency.
  Settlement is idempotent (row lock + unique ledger keys): repeated callbacks or webhooks confirm a
  booking, write the ledger and create the agent's earning exactly once. Money that arrives for an
  expired, cancelled or already-paid booking is recorded and automatically queued for refund.
- **Ledger** (`ledger_entries`, append-only by trigger): each payment is allocated to service fee,
  commission, VAT, agent rent payable, agent cleaning payable and caution held; refunds write exact
  negations. Each entry type belongs to one bucket (`LEDGER_ENTRY_BUCKET` in `@havenhub/shared`):
  HavenHub revenue (service fee + commission), tax payable, agent payable, caution held (the
  customer's deposit — never revenue; no release policy yet) or owed to customer. The admin booking
  page shows the customer payment against those buckets. Agent earnings are `PENDING` until the stay
  starts, then `AVAILABLE`; `REVERSED` on refund. Withdrawals are not built yet.
- **Scheduled jobs** (expire holds, release earnings, complete stays) run on a timer in every API
  instance, but each job takes a Redis lease first (`DistributedLockService`), so only one instance
  runs it at a time. Leases are renewed while the job runs and expire after
  `SCHEDULED_JOB_LOCK_TTL_SECONDS`, so a crashed instance only delays the job. Every item is
  re-checked under a row lock, so a job that runs twice changes nothing the second time. If Redis is
  down the sweep is skipped (and retried next tick); bookings stay correct because creation and
  payment expire lapsed holds themselves.
- **Cancellation policy** (one function): unpaid bookings cancel freely; paid bookings cancelled before
  the stay starts get a full refund request; after it starts only an admin can cancel. Refunds
  (one per payment) are approved by an admin with `payments.refund` and sent through the provider.

| Area     | Routes (`/api/v1`)                                                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public   | `GET properties/:id/availability` · `POST bookings/quote` · `POST payments/webhooks/paystack` (signature-verified)                                                                                           |
| Customer | `GET/POST bookings` · `GET bookings/:id` · `POST bookings/:id/cancel` · `POST bookings/:id/payments` · `POST payments/:reference/verify` · `GET/POST payments/test-checkout/:reference` (test provider only) |
| Agent    | `GET agents/me/bookings`, `agents/me/bookings/:id`, `agents/me/earnings` · `POST agents/me/bookings/:id/cancel`                                                                                              |
| Admin    | `GET admin/bookings`, `admin/bookings/:id` · `POST admin/bookings/:id/cancel` · `GET admin/payments`, `admin/refunds` · `POST admin/refunds/:id/review` · `GET/POST admin/finance/pricing`                   |

## Agent subscriptions (Phase 4)

- **Plans** (`subscription_plans`) are database records managed at `/admin/plans`: name, price per
  interval (`MONTHLY` / `YEARLY`), tier rank, status (`ACTIVE` offered, `INACTIVE` hidden, `ARCHIVED`
  retired) and selling points. Plans that were ever paid for cannot be deleted, only archived.
- **Entitlements** (`subscription_plan_entitlements`, one row per plan and key): `PROPERTY_COUNT`,
  `IMAGES_PER_PROPERTY`, `VIDEOS_PER_PROPERTY`, `FEATURED_PROPERTY_COUNT`, `STORAGE_MB`, plus
  `EVENT_COUNT`, `TOUR_COUNT`, `CLEANING_SERVICE_COUNT`, `HOTEL_COUNT` for features not built yet
  (configurable now; their modules call `PlanLimitsService.assertWithinAllowance`). `0` = not
  included, `null` = unlimited. Limit changes apply to every subscriber immediately.
- **Free plan:** exactly one default plan (price 0, no interval), created by `pnpm db:seed` with
  1 property / 10 photos / 1 video per property and never overwritten afterwards. Agents without a
  paid term are on it. No limit is hardcoded in application code.
- **Terms** (`agent_subscriptions`): one row per paid term, never deleted (trigger) and with its plan
  and price frozen. At most one `ACTIVE` term per agent (partial unique index). The plan in force is
  computed from term dates on every request, so limits never wait for a background job.
- **Billing rules** (`subscription-billing.ts`, shown to the agent before paying): first plan starts
  now; same plan = renewal queued after the current term; higher rank = upgrade, starts now and ends
  the current term (no proration, unused time is not credited); lower or equal rank = downgrade,
  starts when the current term ends. No automatic renewal (an expiry reminder is emailed 3 days
  before). Cancel at period end (undoable) or immediately (no refund).
- **Downgrades and expiry never delete or hide anything.** Over-limit agents keep their listings
  and media but cannot add more; featured slots beyond the new allowance are released.
- **Enforcement** (`PlanLimitsService`): property create/restore, image upload (count + stored
  bytes), video add and featuring check the plan in force inside a transaction after locking the
  agent row (lock order: agent, then property), so concurrent requests cannot exceed a limit.
  Errors are `403 PLAN_LIMIT_REACHED` with `details.entitlement`, `limit`, `used`, `planName`.
- **Payments** use the same `PaymentProvider` abstraction as bookings, in `subscription_payments`
  (reference `HHS-…`; amount, plan and reference frozen by trigger). The amount comes from the plan
  record. A term is created only after server-side verification (reference, amount, currency) under a
  row lock; redirects, webhooks and retries settle a payment exactly once. The Paystack webhook routes
  `HHS-` references to subscriptions. Payments that complete late or in two tabs queue terms rather
  than overlap.
- **Sweep:** `SUBSCRIPTION_SWEEP_INTERVAL_SECONDS` (default 300) ends finished terms, starts queued
  ones and sends reminders, under the same Redis leases as the booking sweep.
- **Notifications** (email): activated/scheduled, payment failed, expiring, ended/cancelled/suspended,
  plan limit reached (at most once a day per allowance).
- **RBAC:** `subscriptions.view` (lists, detail, metrics), `subscriptions.manage` (cancel, suspend,
  reactivate — reason required, audited), `subscriptions.plans` (create/edit plans and limits).
  Finance Admin has all three; Admin has view + manage; Support Admin has view.

| Area   | Routes (`/api/v1`)                                                                                                                                                                                                                                              |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public | `GET subscriptions/plans`                                                                                                                                                                                                                                       |
| Agent  | `GET agents/me/subscription`, `…/quote?planId`, `…/history`, `…/payments` · `POST …/checkout`, `…/payments/:reference/verify`, `…/cancel`, `…/resume` · `POST/DELETE agents/me/properties/:id/feature` · `GET/POST …/test-checkout/:reference` (test provider)  |
| Admin  | `GET/POST admin/subscription-plans` · `GET/PATCH/DELETE admin/subscription-plans/:id` · `POST admin/subscription-plans/:id/status` · `GET admin/subscriptions`, `admin/subscriptions/stats`, `admin/subscriptions/:id` · `POST admin/subscriptions/:id/actions` |

## Messaging (Phase 5)

- **Conversations** (`conversations`, `conversation_participants`) are about one context: a listing
  (`PROPERTY`, started by a customer with the listing's agent) or a booking (`BOOKING`, its customer
  and agent). Each context type has its own nullable foreign key plus a CHECK constraint — no
  polymorphic ids; Phase 6 adds a column and an enum value. A deterministic unique `contextKey` makes
  "start a conversation" a race-safe get-or-create. Participants have a role, so admin/system
  participants need no redesign. Archiving is per participant; a new message unarchives.
- **Messages** get a per-conversation `seq` allocated under the conversation row lock: stable order,
  cursor pagination (`?before=<seq>` older, `?after=<seq>` catch-up) and read cursors. Types: TEXT,
  IMAGE, VIDEO, AUDIO, FILE, SYSTEM. Text is plain text (control/bidi characters stripped) and must be
  rendered as text, never HTML. Replies reference a message in the same conversation; the quote is one
  level deep and redacted if the original is deleted.
- **Lifecycle:** authors edit text for 15 minutes (the previous text is kept in `message_revisions`);
  authors delete any time. Deletion is soft (a trigger forbids hard deletes): content, files, quote and
  reactions vanish from every participant response but stay available to moderators.
- **Idempotency:** each send carries a client-generated `clientKey`; `(sender, clientKey)` is unique in
  the database. A retry returns the original message (200, no duplicate event); concurrent duplicates
  resolve to one row.
- **Read state:** one `lastReadSeq` cursor per participant (monotonic in SQL). Unread = messages from
  others above the cursor, not deleted — one indexed query, no per-message receipts. The other side's
  cursor gives read receipts.
- **Reactions:** one per user per message (primary key), from an allowlist in `@havenhub/shared`.
- **Attachments:** uploaded first (`POST /conversations/:id/attachments`), then referenced when sending.
  The type comes from the file's bytes (images re-encoded to WebP; MP4/MOV/WebM, MP3/M4A/OGG/WAV, PDF,
  DOCX/XLSX/PPTX without macros, UTF-8 TXT/CSV) with per-kind size limits; client MIME types are
  ignored. Files live under the private `chat/` storage prefix — the public media route refuses it, and
  with S3 the prefix must stay out of any public-read policy — and are streamed only to participants
  (`nosniff`, sandbox CSP, private cache). Unsent uploads are removed after 24 hours.
- **Real-time:** Socket.IO on the API (`/realtime`) with the Redis adapter for multiple instances.
  Browsers get a single-use 60 s ticket (`POST /realtime/ticket`) and connect to
  `NEXT_PUBLIC_REALTIME_URL`; mobile clients pass their access token. Each socket joins only its own user
  room; servers emit per-recipient views to participants. Sessions are re-checked every 30 s (revoked →
  disconnected). Events: `conversation.created|updated`, `message.created|updated|deleted`,
  `message.reaction.updated`, `message.read`, `typing.started|stopped` (typing is never stored). Every
  payload has an `eventId`; messages are keyed by id/seq, so duplicates are harmless. The REST API is
  the source of truth: clients re-sync with `?after=<seq>` on reconnect or on a seq gap.
- **Notifications:** live events for in-app updates (including the dashboard unread badge); email is a
  digest — one email per conversation per unread burst after `CHAT_EMAIL_DELAY_SECONDS`, without
  message content, cancelled by reading. Reactions are never emailed. `ChatNotificationChannel` is the
  hook for mobile push later.
- **Access:** participant routes return 404 to non-participants (no id probing). Admins have no
  participant access; support uses `/admin/conversations` with `conversations.view` (every view and
  file download is audited) and `messages.moderate` (remove a message, close/reopen — with a reason,
  audited). Both are granted to Super Admin and Support Admin only.

| Area             | Routes (`/api/v1`)                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Customer / agent | `GET/POST conversations` · `GET conversations/unread`, `conversations/:id` · `POST conversations/:id/read`, `…/archive` · `GET/POST conversations/:id/messages` · `POST conversations/:id/attachments` · `GET conversations/:id/attachments/:attachmentId` · `PATCH/DELETE messages/:id` · `PUT/DELETE messages/:id/reaction` · `POST realtime/ticket` |
| Admin            | `GET admin/conversations`, `admin/conversations/:id`, `admin/conversations/:id/attachments/:attachmentId` · `POST admin/conversations/:id/status`, `admin/messages/:id/remove`                                                                                                                                                                         |

## Advanced admin (Phase 8)

- **Roles:** the nine built-in roles live in code (`system-roles.ts`), are re-synced by `pnpm db:seed`
  and cannot be edited. Admins with `roles.manage` create custom roles from permissions they hold
  themselves, and assign roles from the Users page. Nobody edits a role they hold or changes their
  own roles; a role still assigned to anyone cannot be deleted; the last active Super Admin cannot be
  demoted. Changes lock the affected rows and are audited in the same transaction.
- **Audit log:** append-only in the database (a trigger rejects UPDATE/DELETE; the only allowed change
  is `actor_id → NULL` when the acting user is deleted). `audit.view` lists with filters (actor,
  action or `prefix.`, resource, Nigerian dates) and shows before/after, IP and device per entry.
  Entries are kept indefinitely.
- **Analytics:** live, read-only queries (no rollups), Nigerian calendar dates, integer kobo.
  `analytics.view` covers people, listings and bookings; money needs `analytics.financial`. Revenue is
  the gross value of successful booking payments on their payment date, before refunds; refunds,
  commission, service fees, VAT and subscription revenue are separate. Active users is an
  approximation from the session data kept (each session's sign-in and most recent use, not a
  per-request history): a session used before and after the range but not during it still counts. Features that do not exist yet (ticket sales, withdrawals, reviews, property
  sales) report "not available". Agents see only their own figures at `/agent/analytics`.
- **Moderation policy:** per listing type (properties, events, tours, hotels, cleaning), whether
  publication needs admin review (default: yes, everywhere). With review off, a verified agent's
  submission — and later edits — publish immediately (`*.published_without_review` in the audit log).
  Changes apply to the next submission; existing listings keep their state.
- **Maintenance mode** (`settings.maintenance`): non-admin API requests get `503` + `Retry-After`
  (code `MAINTENANCE_MODE`), and the web proxy serves a branded 503 page (CMS logo and contact
  details). Always available: administrators, `/auth/*`, health checks, payment webhooks,
  `/platform/status`, `/site`, media, background jobs. The switch is cached in Redis and rewritten
  on every change, so all instances flip at once.
- **SMTP** (`settings.smtp`, Super Admin only by default): admin-managed settings override the
  `SMTP_*` variables; with neither, development prints email to the log and production refuses to
  start. One resolver (`MailTransportResolver`) decides for all email: database → environment → none.
  Only encrypted connections (TLS or STARTTLS) on mail ports 25/465/587/2525. Hosts are resolved and
  every address must be public (loopback, private, link-local and reserved ranges are refused when
  saving and again before each send, connecting to the checked address). The password is write-only:
  AES-256-GCM under an HKDF sub-key of `FIELD_ENCRYPTION_KEY` (purpose `smtp-password`), never
  returned, logged or audited. Test emails go only to the signed-in admin and are rate-limited and
  audited. Changes propagate to every instance through a Redis token.
- **Rotating `FIELD_ENCRYPTION_KEY`:** encrypted values (NIN, account numbers, the SMTP password)
  cannot be read with a new key. Before switching keys, note that the SMTP password will need to be
  entered again: after deploying the new key, open Settings → Outgoing email and save the password
  (until then, sending through the database settings fails with "Enter it again", and the log says
  so; the environment SMTP is not used silently). NIN and account numbers need a re-encryption step
  before the key changes (not automated).

| Area      | Routes (`/api/v1`)                                                                                                                                                          |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roles     | `GET admin/rbac/roles`, `admin/rbac/roles/:key`, `admin/rbac/permissions` · `POST admin/rbac/roles` · `PATCH/DELETE admin/rbac/roles/:key` · `PUT admin/users/:id/roles`    |
| Audit     | `GET admin/audit-logs` (filters), `admin/audit-logs/:id`                                                                                                                    |
| Analytics | `GET admin/analytics/overview`, `admin/analytics/financial`, `agents/me/analytics` (`?from&to`)                                                                             |
| Settings  | `GET/PATCH admin/settings/maintenance`, `admin/settings/moderation` · `GET/PUT/DELETE admin/settings/smtp` · `POST admin/settings/smtp/test` · public `GET platform/status` |

## Prerequisites

- **Node.js 24 LTS** (`nvm use` reads `.nvmrc`)
- **pnpm 10** (`corepack enable pnpm` uses the version pinned in `package.json`)
- **Docker** for local PostgreSQL and Redis, or your own PostgreSQL 16+ and Redis 7+ instances

## Getting started

```bash
nvm use
corepack enable pnpm
pnpm install                                  # also generates the Prisma client

cp .env.example .env                          # API + Prisma configuration
cp apps/web/.env.example apps/web/.env.local  # Web configuration

# Fill in FIELD_ENCRYPTION_KEY and AUTH_SECRET in .env:  openssl rand -base64 32

pnpm services:up                              # start PostgreSQL + Redis (Docker)
pnpm db:deploy                                # apply migrations
pnpm db:seed                                  # permissions, roles, starter amenities (idempotent)
pnpm admin:create --email you@example.com --name "Your Name"   # first Super Admin
pnpm dev                                      # shared (watch) + API :4000 + web :3000
```

Without SMTP configured, emails (verification and reset links) are printed to the API log in
development.

Then open:

- Web: http://localhost:3000
- System status page: http://localhost:3000/status
- API health: http://localhost:4000/api/health

If port 5432 or 6379 is already in use on your machine, set `POSTGRES_PORT` / `REDIS_PORT` when
running `pnpm services:up`, and update `DATABASE_URL` / `REDIS_URL` in `.env` to match.

## Scripts

| Command                         | What it does                                            |
| ------------------------------- | ------------------------------------------------------- |
| `pnpm dev`                      | Run shared (watch), API and web in development          |
| `pnpm dev:api` / `pnpm dev:web` | Run a single app                                        |
| `pnpm build`                    | Generate the Prisma client and build every package      |
| `pnpm build:api` / `build:web`  | Build one app plus the workspace packages it depends on |
| `pnpm lint` / `pnpm lint:fix`   | ESLint (type-aware) across the monorepo                 |
| `pnpm format` / `format:check`  | Prettier                                                |
| `pnpm typecheck`                | TypeScript across all packages                          |
| `pnpm test`                     | Unit + integration tests (needs PostgreSQL and Redis)   |
| `pnpm check`                    | Everything CI runs, except the build                    |
| `pnpm services:up` / `:down`    | Start/stop local PostgreSQL + Redis                     |
| `pnpm db:migrate`               | Create and apply a migration in development             |
| `pnpm db:deploy`                | Apply pending migrations (production/CI)                |
| `pnpm db:seed`                  | Sync permissions, system roles and starter amenities    |
| `pnpm admin:create`             | Create an admin (`--email`, `--name`, `--role`)         |
| `pnpm db:studio`                | Prisma Studio                                           |

## Environment variables

See `.env.example` for the full annotated list.

| Variable                              | Used by     | Required | Description                                                                      |
| ------------------------------------- | ----------- | -------- | -------------------------------------------------------------------------------- |
| `DATABASE_URL`                        | API, Prisma | yes      | PostgreSQL connection string                                                     |
| `REDIS_URL`                           | API         | yes      | Redis (rate limiting; caching, queues and chat later)                            |
| `FIELD_ENCRYPTION_KEY`                | API         | yes      | 32-byte base64 key encrypting NIN / account numbers                              |
| `AUTH_SECRET`                         | API         | yes      | 32-byte base64 key signing CSRF tokens                                           |
| `WEB_APP_URL`                         | API         | yes\*    | Web origin, for email links (\*defaults to `http://localhost:3000`)              |
| `CORS_ORIGINS`                        | API         | no       | Allowed browser origins                                                          |
| `SMTP_HOST`, `SMTP_*`                 | API         | prod\*   | SMTP delivery (\*or admin-managed SMTP settings); one is required in production  |
| `REQUIRE_EMAIL_VERIFICATION`          | API         | no       | Require a verified email to sign in (default `true`)                             |
| `ACCESS_TOKEN_TTL_MINUTES`            | API         | no       | Default 15                                                                       |
| `REFRESH_TOKEN_TTL_DAYS`              | API         | no       | Default 30                                                                       |
| `TRUST_PROXY`                         | API         | no       | Proxy hops for client IPs behind a load balancer                                 |
| `API_INTERNAL_URL`                    | Web         | yes\*    | Where the web server reaches the API (\*default `http://localhost:4000`)         |
| `NEXT_PUBLIC_SITE_URL`                | Web         | yes\*    | Canonical site URL                                                               |
| `NEXT_PUBLIC_MAPBOX_TOKEN`            | Web         | prod     | Mapbox public token for map tiles (OpenStreetMap is used in development)         |
| `STORAGE_DRIVER`                      | API         | prod     | `local` (development only) or `s3`                                               |
| `STORAGE_*`                           | API         | with s3  | Bucket, credentials, endpoint and public base URL                                |
| `PAYMENT_PROVIDER`                    | API         | prod     | `test` (development only, simulated) or `paystack`                               |
| `PAYSTACK_SECRET_KEY`                 | API         | paystack | Paystack secret key; also verifies webhook signatures                            |
| `BOOKING_HOLD_MINUTES`                | API         | no       | How long unpaid bookings hold their dates (default 30)                           |
| `SUBSCRIPTION_SWEEP_INTERVAL_SECONDS` | API         | no       | Subscription term/reminder sweep (default 300; 0 disables)                       |
| `CHAT_SWEEP_INTERVAL_SECONDS`         | API         | no       | Chat email digests and unsent-upload cleanup (default 60; 0 disables)            |
| `CHAT_EMAIL_DELAY_SECONDS`            | API         | no       | Unread time before a digest email (default 600)                                  |
| `NEXT_PUBLIC_REALTIME_URL`            | Web         | prod     | Public API origin for the Socket.IO connection (default `http://localhost:4000`) |

Web variables live in `apps/web/.env.example`. **Never commit `.env` files.**

## Deployment notes

- **Web → Vercel:** set the project root to `apps/web` and the build command to
  `cd ../.. && pnpm build:web`, which builds workspace dependencies first. Set
  `API_INTERNAL_URL` (the API's URL), `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_MAPBOX_TOKEN`.
- **API → Railway (or any container/Node host):** build with `pnpm install --frozen-lockfile && pnpm build:api`,
  run `pnpm db:deploy && pnpm --filter @havenhub/api seed:prod` as a pre-deploy step, start with
  `pnpm start:api`, and use `/api/health` as the health check. Set the required variables above,
  plus `NODE_ENV=production`, `TRUST_PROXY` and `CORS_ORIGINS` / `WEB_APP_URL` set to the web origin.

## Roadmap

0. ~~Foundation tooling~~
1. ~~Foundation: auth, roles and permissions, audit logs, agent onboarding, dashboard shells~~
2. ~~Property marketplace: listings, moderation, media, amenities, search, map, details, favourites~~
3. ~~Booking and payments foundation: availability, pricing engine, Paystack abstraction, ledger, refunds~~
   — still to schedule: discount codes and gifting, agent withdrawals, reviews tied to completed bookings
4. ~~Agent subscriptions: plans, entitlements, limits, paid terms, admin management~~
   — later: in-app notifications, automatic renewal (needs stored-card charging), subscription refunds
5. ~~Communication: conversations, messages, attachments, reactions, real-time (Socket.IO), digests~~
   — later: in-app notification centre, support tickets, mobile push, user blocking
6. Events, hotels, tours, vacation zones, cleaning ← _next_
7. CMS: homepage, blog, SEO, careers, help center, email marketing
8. Advanced admin: RBAC management, analytics, moderation
9. Production hardening

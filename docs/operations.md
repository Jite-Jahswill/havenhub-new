# HavenHub operations

Runbooks for running HavenHub in production: web on **Vercel**, API on **Railway**, PostgreSQL,
Redis and S3-compatible storage as managed services. Steps marked **(operator)** depend on your
hosting accounts and are not encoded in this repository. Never paste secret values into tickets,
chats or logs.

## Contents

1. [Health checks](#1-health-checks)
2. [Deployment checklist](#2-deployment-checklist)
3. [Migrations](#3-migrations)
4. [Database recovery (PITR)](#4-database-recovery-pitr)
5. [Paystack payments and webhooks](#5-paystack-payments-and-webhooks)
6. [Refunds with an unknown outcome](#6-refunds-with-an-unknown-outcome)
7. [Storage: public and private objects](#7-storage-public-and-private-objects)
8. [Secret and key rotation](#8-secret-and-key-rotation)
9. [Incident checklist](#9-incident-checklist)

## 1. Health checks

| Endpoint               | Purpose   | `200` when             | `503` when                          |
| ---------------------- | --------- | ---------------------- | ----------------------------------- |
| `GET /api/health/live` | Liveness  | the process is running | never (no answer = process is down) |
| `GET /api/health`      | Readiness | PostgreSQL and Redis   | PostgreSQL **or** Redis is down     |

Both are public, unversioned, and stay available in maintenance mode. Readiness returns a body with
`status` (`ok` / `degraded`) and `checks.database` / `checks.redis` (`up` / `down`).

**How to use them**

- **Restarts (liveness):** point the platform's restart/liveness probe at `/api/health/live`.
  Never use `/api/health` for restarts: a Redis outage would restart every healthy API instance.
- **Deploy gate / traffic (readiness):** use `/api/health` to decide that a new deployment is ready
  (Railway's deploy health check) and in uptime monitoring/alerts. **(operator)** configure both in
  the hosting dashboards.

**Redis down, API up.** The API keeps serving: rate limits are skipped (fail open, log
`rate_limit.unavailable`) and the maintenance flag and SMTP settings are read from the database.
Degraded until Redis returns: scheduled jobs (sweeps, payment reconciliation) skip their runs
because they need a Redis lock, Socket.IO events stop reaching clients on other API instances, and
refund approvals and re-checks are refused with nothing sent (log `refund.lock_unavailable`).

**Readiness fails, liveness passes** — investigate in this order:

1. The readiness body: which of `database` / `redis` is `down`.
2. The provider status pages and connection limits for that service **(operator)**.
3. API logs around the failure: `Redis connection error`, `rate_limit.unavailable`,
   `http.database_error` (kind `unavailable` = database unreachable), `http.request.failed` (5xx).
4. Recent changes to `DATABASE_URL`, `REDIS_URL` or the network.

## 2. Deployment checklist

Before deploying a release to production:

**Configuration** (the API and web app refuse to start with most of these wrong — that is
intended; fix the variable, do not work around the check):

- [ ] API `NODE_ENV=production`; `WEB_APP_URL` and every `CORS_ORIGINS` entry are the public
      `https://` web origin (never localhost).
- [ ] API `TRUST_PROXY=1` (one hop: the Railway edge). Never `true`.
- [ ] `COOKIE_SECURE` unset or `true`.
- [ ] `INTERNAL_API_SECRET` set — the **same value** on Railway (API) and Vercel (web). Generate
      with `openssl rand -base64 32`.
- [ ] `FIELD_ENCRYPTION_KEY` and `AUTH_SECRET` set (32-byte base64) and **unchanged** from the
      previous release unless you are deliberately rotating (§8).
- [ ] `PAYMENT_PROVIDER=paystack` and `PAYSTACK_SECRET_KEY` set (the live key for production).
- [ ] `STORAGE_DRIVER=s3` with `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`,
      `STORAGE_ENDPOINT`/`STORAGE_REGION` and `STORAGE_PUBLIC_BASE_URL`; bucket policy per §7.
- [ ] `REDIS_URL` points at the production Redis (`rediss://` where the provider supports TLS).
- [ ] SMTP: either `SMTP_HOST` + `SMTP_*`, or admin-managed SMTP (Settings → Outgoing email). The
      API refuses to start in production with neither.
- [ ] Web (Vercel): `API_INTERNAL_URL` (the API's `https://` URL), `NEXT_PUBLIC_SITE_URL`,
      `NEXT_PUBLIC_REALTIME_URL`, `NEXT_PUBLIC_MAPBOX_TOKEN`, `INTERNAL_API_SECRET`, and
      `REVALIDATE_SECRET` (same value as the API's).
- [ ] Optional database limits: `DATABASE_POOL_MAX`, `DATABASE_STATEMENT_TIMEOUT_MS`,
      `DATABASE_CONNECT_TIMEOUT_MS` (unset = driver defaults).

**Paystack (operator, one-off and after any URL change):** webhook URL
`https://<api-host>/api/v1/payments/webhooks/paystack` in the Paystack dashboard, for the same
mode (live/test) as `PAYSTACK_SECRET_KEY`.

**Release:**

1. If the release needs downtime (rare — see §3), switch on maintenance mode: Settings →
   Maintenance mode (`settings.maintenance`).
2. Deploy the API with the pre-deploy step from the README's deployment notes,
   `pnpm db:deploy && pnpm --filter @havenhub/api seed:prod` (migrations, then the idempotent
   seed) — configured in Railway **(operator)**. A failed migration stops the deploy (§3).
3. Wait for `/api/health` to return `200` on the new deployment.
4. Deploy the web app.
5. Smoke test: home page and `/properties` load; sign in and out; an admin page loads; an API
   response carries `X-Request-Id`; a page response carries `Content-Security-Policy` and
   `Strict-Transport-Security`; the API logs are JSON lines without errors.
6. Switch maintenance mode off if it was on.

## 3. Migrations

- **Additive by default.** New tables, columns (nullable or defaulted), indexes. Renames, drops and
  type changes need an explicit, reviewed multi-release plan (add → backfill → switch → remove).
- **Review hand-written SQL.** Several migrations add triggers and CHECK constraints by hand
  (append-only ledger/audit log/messages, singletons). Read every `migration.sql` before release.
- **Order:** migrations run in the API pre-deploy step _before_ new API code serves traffic, so the
  previous API version must keep working against the new schema — another reason to stay additive.
- **Locking:** Prisma runs each migration in a transaction. `CREATE INDEX` there blocks writes to
  that table while it builds; on very large tables build the index `CONCURRENTLY` by hand first,
  then mark the migration applied (see the note in `20261005090000_phase9_date_range_indexes`).
- **Roll forward, not back.** Prisma has no down migrations. If a release must be undone, ship a new
  migration (or redeploy the previous code, which still works because migrations are additive).
- **A migration fails:** the deploy stops and the old release keeps serving. Read the error and
  `pnpm exec prisma migrate status`. Fix it with a new or corrected migration that has **not** been
  applied anywhere. Only if a migration partly applied, repair the database deliberately and then
  record the outcome with `prisma migrate resolve --applied|--rolled-back <name>` — never by editing
  the `_prisma_migrations` table or an already-applied migration file.
- **Never** run `prisma migrate dev`, `db push` or `migrate reset` against production.

## 4. Database recovery (PITR)

Assumption: the managed PostgreSQL provider keeps automated backups with point-in-time recovery
(PITR). Confirm the retention window and that it is enabled **(operator)**. Redis holds only
rebuildable state (rate limits, locks, caches, job cursors, chat digest schedule) and is not
backed up.

**Restore**

1. Switch on maintenance mode (§2) so no new data is written to the damaged database.
2. Note the recovery target time (just before the incident) from logs and audit entries.
3. Restore to a **new** database instance at that time **(operator)**. Do not overwrite the
   original — it is evidence.
4. Point a non-production API at the restored database and verify (below).
5. Only then switch production `DATABASE_URL` to the restored instance and redeploy the API.
6. Switch maintenance mode off; keep monitoring logs and reconciliation.

**Verify before directing production traffic to it**

- `pnpm exec prisma migrate status` reports the expected migrations and no drift.
- Row counts of key tables are plausible versus the incident timeline: users, properties,
  bookings, payments, refunds, ledger_entries, subscription_payments, audit_logs.
- Ledger integrity: for each successful payment, the entries with `source_key = 'payment:<id>'`
  sum to the payment amount, and each completed refund has its negating entries.
- The append-only triggers exist (`ledger_entries_append_only`, `audit_logs_append_only`, the
  message triggers).
- **Money after the recovery point:** payments made at Paystack after the target time are not in the
  restored database. Export Paystack transactions for that window **(operator)** and compare by
  reference (`HHP-…` bookings, `HHS-…` subscriptions). The reconciliation sweep only re-checks
  payment rows that exist; missing ones need manual handling.

**Restore drill:** at least quarterly, restore the latest backup to a scratch instance, run the
verification above and record how long it took.

## 5. Paystack payments and webhooks

**How payments settle.** A payment is settled only from Paystack's server-side verification —
reference, amount and currency must match what HavenHub asked for. Three routes reach the same
idempotent, row-locked settlement, so a payment settles once whichever arrives first:

1. the customer returns from checkout (`POST /api/v1/payments/:reference/verify`);
2. the webhook (`charge.success`);
3. the **reconciliation sweep**: every `PAYMENT_RECONCILE_INTERVAL_SECONDS` (default 300) it
   re-verifies PENDING booking and subscription payments created **15 minutes to 72 hours** ago, at
   most 25 of each kind per run.

**Webhook endpoint:** `POST https://<api-host>/api/v1/payments/webhooks/paystack`. Authenticated by
the `x-paystack-signature` header — an HMAC-SHA512 of the raw body with `PAYSTACK_SECRET_KEY`.
Handled events: `charge.success`, `refund.processed`, `refund.failed`. For `charge.success` the body
is never trusted for amounts or status: it only says which payment to re-verify with Paystack. The
refund events are acted on directly once the signature is valid, without another Paystack lookup:
`refund.processed` completes the payment's PROCESSING refund (idempotently) and `refund.failed`
marks it FAILED. It stays available in maintenance mode.

**When webhooks fail** — look for these log events:

| Event                               | Meaning / action                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `webhook.invalid_signature`         | Wrong key or mode (live vs test), or a forged request. Check the dashboard webhook mode and `PAYSTACK_SECRET_KEY`. |
| `webhook.unknown_reference`         | Acknowledged (`200`) and ignored: not a HavenHub reference, or a different environment's.                          |
| `webhook.processing_failed`         | Returned non-2xx so Paystack retries. Check the error code; a database/Redis outage usually explains it.           |
| `payment.reconcile_failed`          | The sweep could not verify a payment (e.g. Paystack unreachable); it retries next run.                             |
| `job.failed` (`payments.reconcile`) | The whole sweep run failed (often Redis/database); retried on the next tick.                                       |

**Pending payments.** A PENDING payment younger than 15 minutes is normal (the customer may still
be paying). Older ones are re-checked automatically until 72 hours. Abandoned checkouts stay
PENDING (Paystack reports them as pending) and drop out after 72 hours. **After 72 hours** nothing
re-checks a payment automatically: look it up in the Paystack dashboard **(operator)**; if Paystack
shows it paid, contact engineering to settle it through the normal verification path — never by
editing rows.

**Mismatched amount, currency or reference.** The payment is marked `FAILED` with a failure
reason starting `Verification mismatch:` and an audit entry `payment.verification_mismatch`;
the booking is not confirmed. Money may have moved: compare the transaction in the Paystack
dashboard **(operator)** with the payment row (`reference`, `amount_kobo`, `currency`) and the
audit entry, then refund the customer from the Paystack dashboard if they were charged. Never mark
such a payment successful by hand.

## 6. Refunds with an unknown outcome

- A refund is sent to Paystack only after HavenHub asks Paystack whether one already exists for
  the payment, under a per-refund lock. A completed or pending refund at Paystack is adopted —
  never duplicated.
- A **timeout, network error or 5xx** leaves the refund **`PROCESSING`** (audit
  `refund.outcome_unknown`, log `refund.outcome_unknown`). It is never marked FAILED for this, and
  nothing is resent automatically.
- A definite refusal marks it `FAILED` (`refund.failed`); "Approve" then retries safely.
- **To resolve a refund stuck in PROCESSING:** an admin with `payments.refund` opens the booking
  (Admin → Bookings → the booking) and uses **Check with payment provider** (`RECHECK`). It
  completes the refund if Paystack has one, keeps waiting if Paystack is still processing it, and
  sends it only if Paystack definitely has none. A `refund.processed` / `refund.failed` webhook also
  settles it.
- If RECHECK is refused with "being processed", another exchange holds the lock — retry in a
  minute. If Redis is down, refund approvals are refused (nothing is sent) until it recovers.
- Before launch, verify one ambiguous refund end to end against Paystack **test mode** (the
  refund lookup uses Paystack's list-refunds endpoint).

## 7. Storage: public and private objects

Object keys are generated by the API (`<prefix>/<uuid>/<uuid>[-variant].<ext>`).

| Prefix                                                      | Content                                                 | Access                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| `properties/`, `experiences/`, `zones/`, `avatars/`, `cms/` | Listing, destination, profile and CMS images (WebP/PNG) | **Public** read (bucket/CDN URL)                                 |
| `chat/`                                                     | Chat attachments                                        | **Private** — streamed by the API to participants only           |
| `careers/`                                                  | Job applicants' CVs                                     | **Private** — streamed only with `careers.applications`, audited |

**Bucket policy (operator):** grant public read **only** to the public prefixes above (or to
everything except `chat/` and `careers/`). Never make the whole bucket public. The API's own
`/api/media` route serves only public keys and refuses private prefixes.

**Verify** after any bucket-policy change: an anonymous request for a known `chat/…` or
`careers/…` object URL must return 403/404, and a listing image URL must return 200. If a private
object was reachable, fix the policy first, then review access logs **(operator)** and treat it as a
data incident (§9). If a public image is unexpectedly private, check the policy covers its prefix.

## 8. Secret and key rotation

**Immediate** = change and redeploy, no user impact. **Coordinated** = several systems must change
together. **Requires data handling** = existing data depends on the key.

- `PAYSTACK_SECRET_KEY` — **Coordinated.** Roll the key in the Paystack dashboard **(operator)**, then update Railway and redeploy the API at once. Until it is redeployed, starting and verifying payments and refunds fail, and webhooks signed with the new key are refused (`401`) until the API has it; Paystack retries them and the reconciliation sweep covers the gap.
- `INTERNAL_API_SECRET` — **Coordinated, no data impact.** Set the new value on Railway and Vercel and redeploy both. Only one value is accepted, so between the two deploys visitor IPs are not forwarded (server-side calls count as the web server's IP for rate limits) — keep the window short.
- `REVALIDATE_SECRET` — **Coordinated, no data impact.** Update API and web together; while they differ, CMS edits appear within ~60 s instead of instantly.
- SMTP credentials — **Immediate.** Admin-managed: change the password at the mail provider, then Settings → Outgoing email (write-only; all instances pick it up). Environment SMTP: update `SMTP_*` and redeploy. Send a test email afterwards.
- `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` — **Immediate.** Create a new key pair at the provider **(operator)**, update Railway, redeploy, then revoke the old pair.
- `DATABASE_URL` / `REDIS_URL` credentials — **Immediate** via the provider **(operator)**; update Railway and redeploy.
- `AUTH_SECRET` — **Coordinated, user-visible.** It signs CSRF tokens and newsletter unsubscribe links. After rotation, signed-in web users may need to reload or sign in again before forms work, and **every unsubscribe link in emails already sent stops working** (people can still unsubscribe from newer emails or via support). Sessions themselves stay valid. Rotate only on suspicion of compromise.
- `FIELD_ENCRYPTION_KEY` — **Requires data handling — do not rotate without a plan.** It encrypts agent NIN and payout account numbers (no automated re-encryption exists) and, via a derived key, the admin-managed SMTP password. Changing it makes those values unreadable: NIN/account numbers need a re-encryption step written and tested first; the SMTP password must be re-entered in Settings → Outgoing email (sending fails with "Enter it again" until then; environment SMTP is not used silently). See also the README's Phase 8 SMTP notes.

## 9. Incident checklist

1. **Identify:** what is broken, since when, for whom. Note the time (WAT and UTC).
2. **Capture ids:** API responses carry `X-Request-Id`; background work logs `job` and `runId`. The
   "Reference" on a web error page is the web app's error digest (search the Vercel logs for it).
3. **Health:** `/api/health/live` and `/api/health` (§1).
4. **Logs:** API logs are JSON lines — filter by `requestId`, `event` (`http.unhandled_error`,
   `http.request.failed`, `http.database_error`, `job.failed`, `webhook.*`, `payment.*`, `refund.*`,
   `mail.send_failed`, `auth.login_failed`, `rate_limit.*`) and `level`.
5. **Dependencies:** PostgreSQL and Redis status and connection counts **(operator)**.
6. **Money involved?** Check `webhook.*`, `payment.reconcile_failed`, refunds stuck in PROCESSING
   (§6), payments with `Verification mismatch` (§5), and Paystack's dashboard for the same window.
7. **Contain:** if data is at risk or the site is misbehaving for customers, switch on maintenance
   mode (Settings → Maintenance mode); admins, sign-in, webhooks and jobs keep working.
8. **Preserve evidence:** do not delete logs, rows or the original database; the audit log is
   append-only. Restore to a new instance (§4) rather than overwriting.
9. **Communicate:** status updates to the team and affected customers **(operator)**.
10. **Recover and verify:** fix, redeploy or restore; re-run the §2 smoke test; watch logs for an hour.
11. **Review:** within a week, a short blameless write-up — timeline, cause, what detected it, and
    follow-up actions.

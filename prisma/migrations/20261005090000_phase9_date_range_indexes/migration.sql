-- Phase 9 (B4): indexes for date-range reporting queries. Additive only.
--
-- Plain CREATE INDEX (Prisma runs each migration in a transaction, which
-- CONCURRENTLY cannot use) briefly blocks writes to each table while its
-- index builds. These tables are small today, so that is milliseconds; on a
-- much larger deployment, build the same indexes CONCURRENTLY by hand first
-- and mark this migration applied (`prisma migrate resolve --applied`).

-- CreateIndex
CREATE INDEX "payments_paid_at_idx" ON "payments"("paid_at");

-- CreateIndex
CREATE INDEX "refunds_completed_at_idx" ON "refunds"("completed_at");

-- CreateIndex
CREATE INDEX "sessions_last_used_at_idx" ON "sessions"("last_used_at");

-- CreateIndex
CREATE INDEX "subscription_payments_paid_at_idx" ON "subscription_payments"("paid_at");


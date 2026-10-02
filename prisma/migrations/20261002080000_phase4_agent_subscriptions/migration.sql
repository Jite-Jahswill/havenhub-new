-- Phase 4: agent subscription plans, entitlements, subscription terms,
-- subscription payments, and agent-featured properties. Additive only.

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SubscriptionPlanStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EntitlementKey" AS ENUM ('PROPERTY_COUNT', 'IMAGES_PER_PROPERTY', 'VIDEOS_PER_PROPERTY', 'FEATURED_PROPERTY_COUNT', 'STORAGE_MB', 'EVENT_COUNT', 'TOUR_COUNT', 'CLEANING_SERVICE_COUNT', 'HOTEL_COUNT');

-- CreateEnum
CREATE TYPE "AgentSubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'CANCELLED', 'EXPIRED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SubscriptionChangeType" AS ENUM ('NEW', 'RENEWAL', 'UPGRADE', 'DOWNGRADE');

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "featured_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "description" VARCHAR(500),
    "status" "SubscriptionPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "price_kobo" BIGINT NOT NULL DEFAULT 0,
    "currency" "Currency" NOT NULL DEFAULT 'NGN',
    "billing_interval" "BillingInterval",
    "rank" INTEGER NOT NULL DEFAULT 0,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plan_entitlements" (
    "plan_id" UUID NOT NULL,
    "key" "EntitlementKey" NOT NULL,
    "limit" INTEGER,

    CONSTRAINT "subscription_plan_entitlements_pkey" PRIMARY KEY ("plan_id","key")
);

-- CreateTable
CREATE TABLE "agent_subscriptions" (
    "id" UUID NOT NULL,
    "agent_profile_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "AgentSubscriptionStatus" NOT NULL,
    "change_type" "SubscriptionChangeType" NOT NULL,
    "price_kobo" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'NGN',
    "billing_interval" "BillingInterval" NOT NULL,
    "current_period_start" TIMESTAMPTZ(3) NOT NULL,
    "current_period_end" TIMESTAMPTZ(3) NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "cancelled_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "end_reason" VARCHAR(200),
    "suspended_at" TIMESTAMPTZ(3),
    "expiry_reminder_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agent_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_payments" (
    "id" UUID NOT NULL,
    "agent_profile_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "subscription_id" UUID,
    "provider" "PaymentProviderName" NOT NULL,
    "reference" VARCHAR(64) NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'NGN',
    "billing_interval" "BillingInterval" NOT NULL,
    "plan_name" VARCHAR(60) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider_transaction_id" VARCHAR(64),
    "failure_reason" VARCHAR(300),
    "paid_at" TIMESTAMPTZ(3),
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_slug_key" ON "subscription_plans"("slug");

-- CreateIndex
CREATE INDEX "subscription_plans_status_rank_idx" ON "subscription_plans"("status", "rank");

-- CreateIndex
CREATE INDEX "agent_subscriptions_agent_profile_id_status_idx" ON "agent_subscriptions"("agent_profile_id", "status");

-- CreateIndex
CREATE INDEX "agent_subscriptions_status_current_period_end_idx" ON "agent_subscriptions"("status", "current_period_end");

-- CreateIndex
CREATE INDEX "agent_subscriptions_plan_id_status_idx" ON "agent_subscriptions"("plan_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_payments_reference_key" ON "subscription_payments"("reference");

-- CreateIndex
CREATE INDEX "subscription_payments_agent_profile_id_created_at_idx" ON "subscription_payments"("agent_profile_id", "created_at");

-- CreateIndex
CREATE INDEX "subscription_payments_status_created_at_idx" ON "subscription_payments"("status", "created_at");

-- CreateIndex
CREATE INDEX "properties_agent_profile_id_featured_at_idx" ON "properties"("agent_profile_id", "featured_at");

-- AddForeignKey
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_plan_entitlements" ADD CONSTRAINT "subscription_plan_entitlements_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_subscriptions" ADD CONSTRAINT "agent_subscriptions_agent_profile_id_fkey" FOREIGN KEY ("agent_profile_id") REFERENCES "agent_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_subscriptions" ADD CONSTRAINT "agent_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_agent_profile_id_fkey" FOREIGN KEY ("agent_profile_id") REFERENCES "agent_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "agent_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Integrity rules Prisma cannot express ─────────────────────────────────

-- Exactly one free default plan at most; paid plans always have a price and an interval.
CREATE UNIQUE INDEX "subscription_plans_one_default_idx" ON "subscription_plans" ("is_default") WHERE "is_default";
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_price_shape_check" CHECK (
  ("is_default" AND "price_kobo" = 0 AND "billing_interval" IS NULL)
  OR (NOT "is_default" AND "price_kobo" > 0 AND "billing_interval" IS NOT NULL)
);
ALTER TABLE "subscription_plan_entitlements" ADD CONSTRAINT "subscription_plan_entitlements_limit_check" CHECK ("limit" IS NULL OR "limit" >= 0);

-- At most one ACTIVE term per agent, so entitlements are never ambiguous.
CREATE UNIQUE INDEX "agent_subscriptions_one_active_idx" ON "agent_subscriptions" ("agent_profile_id") WHERE "status" = 'ACTIVE';
ALTER TABLE "agent_subscriptions" ADD CONSTRAINT "agent_subscriptions_period_check" CHECK ("current_period_end" > "current_period_start");
ALTER TABLE "agent_subscriptions" ADD CONSTRAINT "agent_subscriptions_price_check" CHECK ("price_kobo" > 0);
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_amount_check" CHECK ("amount_kobo" > 0);

-- Subscription history and payments are never deleted, and what was bought
-- (and for how much) never changes after the fact.
CREATE FUNCTION "forbid_subscription_record_delete"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are permanent records and cannot be deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "freeze_subscription_payment"() RETURNS trigger AS $$
BEGIN
  IF NEW."agent_profile_id" IS DISTINCT FROM OLD."agent_profile_id"
     OR NEW."plan_id" IS DISTINCT FROM OLD."plan_id"
     OR NEW."provider" IS DISTINCT FROM OLD."provider"
     OR NEW."reference" IS DISTINCT FROM OLD."reference"
     OR NEW."amount_kobo" IS DISTINCT FROM OLD."amount_kobo"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."billing_interval" IS DISTINCT FROM OLD."billing_interval"
     OR NEW."plan_name" IS DISTINCT FROM OLD."plan_name"
     OR (OLD."subscription_id" IS NOT NULL AND NEW."subscription_id" IS DISTINCT FROM OLD."subscription_id") THEN
    RAISE EXCEPTION 'subscription_payments: amount, plan, reference and applied term are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "freeze_agent_subscription"() RETURNS trigger AS $$
BEGIN
  IF NEW."agent_profile_id" IS DISTINCT FROM OLD."agent_profile_id"
     OR NEW."plan_id" IS DISTINCT FROM OLD."plan_id"
     OR NEW."change_type" IS DISTINCT FROM OLD."change_type"
     OR NEW."price_kobo" IS DISTINCT FROM OLD."price_kobo"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."billing_interval" IS DISTINCT FROM OLD."billing_interval" THEN
    RAISE EXCEPTION 'agent_subscriptions: agent, plan and price of a term are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "subscription_payments_no_delete" BEFORE DELETE ON "subscription_payments"
  FOR EACH ROW EXECUTE FUNCTION "forbid_subscription_record_delete"();
CREATE TRIGGER "agent_subscriptions_no_delete" BEFORE DELETE ON "agent_subscriptions"
  FOR EACH ROW EXECUTE FUNCTION "forbid_subscription_record_delete"();
CREATE TRIGGER "subscription_payments_frozen" BEFORE UPDATE ON "subscription_payments"
  FOR EACH ROW EXECUTE FUNCTION "freeze_subscription_payment"();
CREATE TRIGGER "agent_subscriptions_frozen" BEFORE UPDATE ON "agent_subscriptions"
  FOR EACH ROW EXECUTE FUNCTION "freeze_agent_subscription"();

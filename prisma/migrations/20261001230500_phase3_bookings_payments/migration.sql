-- Phase 3: bookings, availability, pricing configuration, payments, refunds,
-- financial ledger and agent earnings.

-- Needed for the exclusion constraint that combines a UUID equality with a
-- date-range overlap (trusted extension; no superuser required).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('AWAITING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CancelledBy" AS ENUM ('CUSTOMER', 'AGENT', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "PriceLineKind" AS ENUM ('RENT', 'LISTING_DISCOUNT', 'CLEANING_FEE', 'CAUTION_FEE', 'SERVICE_FEE', 'VAT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentProviderName" AS ENUM ('PAYSTACK', 'TEST');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('PLATFORM_SERVICE_FEE', 'PLATFORM_COMMISSION', 'VAT_PAYABLE', 'AGENT_RENT_PAYABLE', 'AGENT_CLEANING_PAYABLE', 'CAUTION_HELD', 'UNALLOCATED');

-- CreateEnum
CREATE TYPE "AgentEarningStatus" AS ENUM ('PENDING', 'AVAILABLE', 'REVERSED');

-- CreateTable
CREATE TABLE "pricing_configs" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "service_fee_bps" INTEGER NOT NULL,
    "agent_commission_bps" INTEGER NOT NULL,
    "vat_bps" INTEGER NOT NULL,
    "vat_on_service_fee" BOOLEAN NOT NULL,
    "vat_on_stay" BOOLEAN NOT NULL,
    "note" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(20) NOT NULL,
    "customer_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "agent_profile_id" UUID NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "pricing_period" "PricingPeriod" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,
    "guests" SMALLINT,
    "cleaning_selected" BOOLEAN NOT NULL DEFAULT false,
    "currency" "Currency" NOT NULL DEFAULT 'NGN',
    "stay_kobo" BIGINT NOT NULL,
    "cleaning_kobo" BIGINT NOT NULL,
    "caution_kobo" BIGINT NOT NULL,
    "service_fee_kobo" BIGINT NOT NULL,
    "vat_kobo" BIGINT NOT NULL,
    "total_kobo" BIGINT NOT NULL,
    "agent_commission_kobo" BIGINT NOT NULL,
    "agent_payout_kobo" BIGINT NOT NULL,
    "pricing_config_id" UUID NOT NULL,
    "property_snapshot" JSONB NOT NULL,
    "hold_expires_at" TIMESTAMPTZ(3),
    "confirmed_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "expired_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by" "CancelledBy",
    "cancellation_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_line_items" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "kind" "PriceLineKind" NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "quantity" INTEGER,
    "unit_amount_kobo" BIGINT,
    "amount_kobo" BIGINT NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "booking_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "provider" "PaymentProviderName" NOT NULL,
    "reference" VARCHAR(64) NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'NGN',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider_transaction_id" VARCHAR(64),
    "failure_reason" VARCHAR(300),
    "paid_at" TIMESTAMPTZ(3),
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" VARCHAR(500) NOT NULL,
    "requested_by" "CancelledBy" NOT NULL,
    "review_note" VARCHAR(500),
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "provider_refund_id" VARCHAR(64),
    "failure_reason" VARCHAR(300),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "source_key" VARCHAR(80) NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "booking_id" UUID NOT NULL,
    "payment_id" UUID,
    "refund_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_earnings" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "agent_profile_id" UUID NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "status" "AgentEarningStatus" NOT NULL DEFAULT 'PENDING',
    "available_at" TIMESTAMPTZ(3),
    "reversed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agent_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pricing_configs_version_key" ON "pricing_configs"("version");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_reference_key" ON "bookings"("reference");

-- CreateIndex
CREATE INDEX "bookings_customer_id_created_at_idx" ON "bookings"("customer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "bookings_agent_profile_id_created_at_idx" ON "bookings"("agent_profile_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "bookings_property_id_status_start_date_idx" ON "bookings"("property_id", "status", "start_date");

-- CreateIndex
CREATE INDEX "bookings_status_hold_expires_at_idx" ON "bookings"("status", "hold_expires_at");

-- CreateIndex
CREATE INDEX "bookings_status_end_date_idx" ON "bookings"("status", "end_date");

-- CreateIndex
CREATE INDEX "bookings_created_at_idx" ON "bookings"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "booking_line_items_booking_id_kind_key" ON "booking_line_items"("booking_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "payments_reference_key" ON "payments"("reference");

-- CreateIndex
CREATE INDEX "payments_booking_id_created_at_idx" ON "payments"("booking_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_payment_id_key" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "refunds_status_created_at_idx" ON "refunds"("status", "created_at");

-- CreateIndex
CREATE INDEX "refunds_booking_id_idx" ON "refunds"("booking_id");

-- CreateIndex
CREATE INDEX "ledger_entries_booking_id_idx" ON "ledger_entries"("booking_id");

-- CreateIndex
CREATE INDEX "ledger_entries_type_created_at_idx" ON "ledger_entries"("type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_source_key_type_key" ON "ledger_entries"("source_key", "type");

-- CreateIndex
CREATE UNIQUE INDEX "agent_earnings_booking_id_key" ON "agent_earnings"("booking_id");

-- CreateIndex
CREATE INDEX "agent_earnings_agent_profile_id_status_idx" ON "agent_earnings"("agent_profile_id", "status");

-- AddForeignKey
ALTER TABLE "pricing_configs" ADD CONSTRAINT "pricing_configs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_agent_profile_id_fkey" FOREIGN KEY ("agent_profile_id") REFERENCES "agent_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_pricing_config_id_fkey" FOREIGN KEY ("pricing_config_id") REFERENCES "pricing_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_line_items" ADD CONSTRAINT "booking_line_items_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_earnings" ADD CONSTRAINT "agent_earnings_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_earnings" ADD CONSTRAINT "agent_earnings_agent_profile_id_fkey" FOREIGN KEY ("agent_profile_id") REFERENCES "agent_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Integrity rules Prisma cannot express ──────────────────────────────────

-- Availability: no two date-holding bookings of one property may overlap.
-- Stays are half-open [start_date, end_date), so a check-out day can be the
-- next guest's check-in day. This is the final guard behind the service's
-- row lock: even a bug or a raw insert cannot double-book a property.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "property_id" WITH =,
    daterange("start_date", "end_date", '[)') WITH &&
  ) WHERE ("status" IN ('AWAITING_PAYMENT', 'CONFIRMED', 'COMPLETED'));

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_dates_check" CHECK ("end_date" > "start_date");
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_amounts_check" CHECK (
  "stay_kobo" >= 0 AND "cleaning_kobo" >= 0 AND "caution_kobo" >= 0 AND
  "service_fee_kobo" >= 0 AND "vat_kobo" >= 0 AND "agent_commission_kobo" >= 0 AND
  "agent_payout_kobo" >= 0
);
-- The customer total and the agent's share can never drift from their parts.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_total_check" CHECK (
  "total_kobo" = "stay_kobo" + "cleaning_kobo" + "caution_kobo" + "service_fee_kobo" + "vat_kobo"
);
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_agent_payout_check" CHECK (
  "agent_payout_kobo" = "stay_kobo" + "cleaning_kobo" - "agent_commission_kobo"
);

ALTER TABLE "pricing_configs" ADD CONSTRAINT "pricing_configs_rates_check" CHECK (
  "service_fee_bps" BETWEEN 0 AND 5000 AND "agent_commission_bps" BETWEEN 0 AND 5000 AND
  "vat_bps" BETWEEN 0 AND 5000
);

ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK ("amount_kobo" > 0);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_check" CHECK ("amount_kobo" > 0);
ALTER TABLE "agent_earnings" ADD CONSTRAINT "agent_earnings_amount_check" CHECK ("amount_kobo" >= 0);
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_source_check" CHECK (
  ("payment_id" IS NOT NULL AND "refund_id" IS NULL AND "source_key" = 'payment:' || "payment_id") OR
  ("refund_id" IS NOT NULL AND "source_key" = 'refund:' || "refund_id")
);

-- Ledger entries are immutable: corrections are new (negating) entries.
CREATE FUNCTION "forbid_ledger_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ledger_entries_append_only"
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "forbid_ledger_mutation"();

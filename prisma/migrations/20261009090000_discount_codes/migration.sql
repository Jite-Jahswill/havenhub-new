-- Discount codes (agent plan discounts first) and their uses. Additive.

-- AlterTable
ALTER TABLE "subscription_payments" ADD COLUMN     "discount_code" VARCHAR(32),
ADD COLUMN     "discount_kobo" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "discount_codes" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "scope" VARCHAR(20) NOT NULL,
    "description" VARCHAR(300),
    "percent_off" INTEGER,
    "amount_off_kobo" BIGINT,
    "plan_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "agent_profile_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "max_redemptions" INTEGER,
    "per_agent_limit" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "discount_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_redemptions" (
    "id" UUID NOT NULL,
    "discount_code_id" UUID NOT NULL,
    "agent_profile_id" UUID NOT NULL,
    "subscription_payment_id" UUID NOT NULL,
    "amount_off_kobo" BIGINT NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "discount_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discount_codes_code_key" ON "discount_codes"("code");

-- CreateIndex
CREATE INDEX "discount_codes_scope_active_idx" ON "discount_codes"("scope", "active");

-- CreateIndex
CREATE UNIQUE INDEX "discount_redemptions_subscription_payment_id_key" ON "discount_redemptions"("subscription_payment_id");

-- CreateIndex
CREATE INDEX "discount_redemptions_discount_code_id_status_idx" ON "discount_redemptions"("discount_code_id", "status");

-- CreateIndex
CREATE INDEX "discount_redemptions_agent_profile_id_discount_code_id_idx" ON "discount_redemptions"("agent_profile_id", "discount_code_id");

-- AddForeignKey
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_discount_code_id_fkey" FOREIGN KEY ("discount_code_id") REFERENCES "discount_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_agent_profile_id_fkey" FOREIGN KEY ("agent_profile_id") REFERENCES "agent_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_subscription_payment_id_fkey" FOREIGN KEY ("subscription_payment_id") REFERENCES "subscription_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exactly one kind of discount, within sane bounds; codes are stored upper-case.
ALTER TABLE "discount_codes"
  ADD CONSTRAINT "discount_codes_one_kind" CHECK (("percent_off" IS NULL) <> ("amount_off_kobo" IS NULL)),
  ADD CONSTRAINT "discount_codes_percent_range" CHECK ("percent_off" IS NULL OR "percent_off" BETWEEN 1 AND 90),
  ADD CONSTRAINT "discount_codes_amount_positive" CHECK ("amount_off_kobo" IS NULL OR "amount_off_kobo" > 0),
  ADD CONSTRAINT "discount_codes_code_upper" CHECK ("code" = upper("code")),
  ADD CONSTRAINT "discount_codes_scope" CHECK ("scope" IN ('SUBSCRIPTION')),
  ADD CONSTRAINT "discount_codes_limits" CHECK (("max_redemptions" IS NULL OR "max_redemptions" > 0) AND "per_agent_limit" > 0),
  ADD CONSTRAINT "discount_codes_window" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "starts_at" < "ends_at");
ALTER TABLE "discount_redemptions"
  ADD CONSTRAINT "discount_redemptions_status" CHECK ("status" IN ('PENDING', 'REDEEMED', 'RELEASED')),
  ADD CONSTRAINT "discount_redemptions_amount_positive" CHECK ("amount_off_kobo" > 0);
ALTER TABLE "subscription_payments"
  ADD CONSTRAINT "subscription_payments_discount_non_negative" CHECK ("discount_kobo" >= 0);

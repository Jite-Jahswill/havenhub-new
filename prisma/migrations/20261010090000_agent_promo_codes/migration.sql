-- Agent promo codes for property bookings, and "X% off" on experiences.
-- Builds on 20261009090000_discount_codes without losing data: columns are
-- renamed or back-filled, never dropped with values in them.

-- Price line for an agent's promo code (negative, like the listing discount).
ALTER TYPE "PriceLineKind" ADD VALUE 'PROMO_DISCOUNT';

-- Bookings remember the code and what it took off the stay.
ALTER TABLE "bookings"
  ADD COLUMN "promo_code" VARCHAR(32),
  ADD COLUMN "promo_discount_kobo" BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT "bookings_promo_discount_non_negative" CHECK ("promo_discount_kobo" >= 0);

-- Experiences: a display discount.
ALTER TABLE "experiences"
  ADD COLUMN "discount_percent" SMALLINT,
  ADD CONSTRAINT "experiences_discount_percent_range" CHECK ("discount_percent" IS NULL OR "discount_percent" BETWEEN 1 AND 90);

-- Codes: an owner (platform or agent), properties, and a per-person limit.
ALTER TABLE "discount_codes" RENAME COLUMN "per_agent_limit" TO "per_user_limit";
ALTER TABLE "discount_codes"
  ADD COLUMN "owner_key" VARCHAR(40) NOT NULL DEFAULT 'PLATFORM',
  ADD COLUMN "owner_agent_profile_id" UUID,
  ADD COLUMN "property_ids" UUID[] DEFAULT ARRAY[]::UUID[];
DROP INDEX "discount_codes_code_key";
CREATE UNIQUE INDEX "discount_codes_owner_key_code_key" ON "discount_codes"("owner_key", "code");
CREATE INDEX "discount_codes_owner_agent_profile_id_idx" ON "discount_codes"("owner_agent_profile_id");
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_owner_agent_profile_id_fkey" FOREIGN KEY ("owner_agent_profile_id") REFERENCES "agent_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "discount_codes" DROP CONSTRAINT "discount_codes_scope";
ALTER TABLE "discount_codes" DROP CONSTRAINT "discount_codes_limits";
ALTER TABLE "discount_codes"
  ADD CONSTRAINT "discount_codes_scope" CHECK ("scope" IN ('SUBSCRIPTION', 'BOOKING')),
  ADD CONSTRAINT "discount_codes_limits" CHECK (("max_redemptions" IS NULL OR "max_redemptions" > 0) AND "per_user_limit" > 0),
  -- Plan codes belong to the platform; booking codes to exactly one agent.
  ADD CONSTRAINT "discount_codes_owner" CHECK (
    ("scope" = 'SUBSCRIPTION' AND "owner_agent_profile_id" IS NULL AND "owner_key" = 'PLATFORM')
    OR ("scope" = 'BOOKING' AND "owner_agent_profile_id" IS NOT NULL AND "owner_key" = "owner_agent_profile_id"::text)
  );

-- Uses: who used it (agent or customer) and what for (plan payment or booking).
ALTER TABLE "discount_redemptions"
  ADD COLUMN "user_id" UUID,
  ADD COLUMN "booking_id" UUID,
  ALTER COLUMN "subscription_payment_id" DROP NOT NULL;
UPDATE "discount_redemptions" r SET "user_id" = a."user_id"
  FROM "agent_profiles" a WHERE a."id" = r."agent_profile_id";
ALTER TABLE "discount_redemptions" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "discount_redemptions" DROP CONSTRAINT "discount_redemptions_agent_profile_id_fkey";
DROP INDEX "discount_redemptions_agent_profile_id_discount_code_id_idx";
ALTER TABLE "discount_redemptions" DROP COLUMN "agent_profile_id";
CREATE INDEX "discount_redemptions_user_id_discount_code_id_idx" ON "discount_redemptions"("user_id", "discount_code_id");
CREATE UNIQUE INDEX "discount_redemptions_booking_id_key" ON "discount_redemptions"("booking_id");
ALTER TABLE "discount_redemptions"
  ADD CONSTRAINT "discount_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "discount_redemptions_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "discount_redemptions_one_target" CHECK (("subscription_payment_id" IS NULL) <> ("booking_id" IS NULL));

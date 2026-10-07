-- Reviews after completed stays, property rating counters, and admin-designed badges. Additive.

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "completed_bookings" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rating_sum" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "review_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "rating" SMALLINT NOT NULL,
    "comment" VARCHAR(2000),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PUBLISHED',
    "hidden_reason" VARCHAR(500),
    "hidden_by_id" UUID,
    "hidden_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badges" (
    "id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "description" VARCHAR(200),
    "image_id" UUID NOT NULL,
    "mode" VARCHAR(20) NOT NULL,
    "min_rating" DECIMAL(2,1),
    "min_reviews" INTEGER,
    "min_completed_bookings" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badge_awards" (
    "badge_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "assigned_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "badge_awards_pkey" PRIMARY KEY ("badge_id","property_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reviews_booking_id_key" ON "reviews"("booking_id");

-- CreateIndex
CREATE INDEX "reviews_property_id_status_created_at_idx" ON "reviews"("property_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reviews_status_created_at_idx" ON "reviews"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "badge_awards_property_id_idx" ON "badge_awards"("property_id");

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_hidden_by_id_fkey" FOREIGN KEY ("hidden_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "badges" ADD CONSTRAINT "badges_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "cms_media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "badge_awards" ADD CONSTRAINT "badge_awards_badge_id_fkey" FOREIGN KEY ("badge_id") REFERENCES "badges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "badge_awards" ADD CONSTRAINT "badge_awards_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "badge_awards" ADD CONSTRAINT "badge_awards_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5),
  ADD CONSTRAINT "reviews_status" CHECK ("status" IN ('PUBLISHED', 'HIDDEN'));
ALTER TABLE "properties"
  ADD CONSTRAINT "properties_review_counters" CHECK (
    "review_count" >= 0 AND "rating_sum" BETWEEN "review_count" AND 5 * "review_count"
  ),
  ADD CONSTRAINT "properties_completed_bookings_non_negative" CHECK ("completed_bookings" >= 0);
ALTER TABLE "badges"
  ADD CONSTRAINT "badges_mode" CHECK ("mode" IN ('MANUAL', 'AUTOMATIC')),
  ADD CONSTRAINT "badges_min_rating_range" CHECK ("min_rating" IS NULL OR "min_rating" BETWEEN 1 AND 5),
  ADD CONSTRAINT "badges_min_counts" CHECK (
    ("min_reviews" IS NULL OR "min_reviews" >= 0) AND ("min_completed_bookings" IS NULL OR "min_completed_bookings" >= 0)
  ),
  -- An automatic badge needs at least one rule, or it would go to every property.
  ADD CONSTRAINT "badges_automatic_has_rule" CHECK (
    "mode" <> 'AUTOMATIC' OR "min_rating" IS NOT NULL OR "min_reviews" IS NOT NULL OR "min_completed_bookings" IS NOT NULL
  );
ALTER TABLE "badge_awards"
  ADD CONSTRAINT "badge_awards_source" CHECK ("source" IN ('MANUAL', 'AUTOMATIC'));

-- Existing completed stays count towards badges from the start.
UPDATE "properties" p SET "completed_bookings" = c.n
  FROM (SELECT "property_id", count(*)::int AS n FROM "bookings" WHERE "status" = 'COMPLETED' GROUP BY "property_id") c
  WHERE c."property_id" = p."id";

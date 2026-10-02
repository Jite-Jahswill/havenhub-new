-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('APARTMENT', 'SELF_CONTAINED', 'HOUSE', 'DUPLEX', 'BUNGALOW', 'TERRACE', 'PENTHOUSE', 'LAND', 'SHOP', 'OFFICE', 'WAREHOUSE');

-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('RENT', 'SALE');

-- CreateEnum
CREATE TYPE "PricingPeriod" AS ENUM ('DAILY', 'MONTHLY', 'YEARLY', 'SALE');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CleaningOption" AS ENUM ('INCLUDED', 'AVAILABLE_FOR_FEE', 'CUSTOMER_MUST_CLEAN', 'NOT_AVAILABLE');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('NGN');

-- CreateEnum
CREATE TYPE "VideoProvider" AS ENUM ('YOUTUBE', 'VIMEO');

-- CreateEnum
CREATE TYPE "AmenityCategory" AS ENUM ('ESSENTIALS', 'FEATURES', 'SAFETY', 'HOSPITALITY');

-- CreateTable
CREATE TABLE "properties" (
    "id" UUID NOT NULL,
    "agent_profile_id" UUID NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "status" "PropertyStatus" NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(5000),
    "property_type" "PropertyType" NOT NULL,
    "listing_type" "ListingType" NOT NULL,
    "pricing_period" "PricingPeriod",
    "address_line" VARCHAR(240),
    "city" VARCHAR(100),
    "lga" VARCHAR(100),
    "state" VARCHAR(60),
    "country" CHAR(2) NOT NULL DEFAULT 'NG',
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "size_sqm" INTEGER,
    "bedrooms" SMALLINT,
    "bathrooms" SMALLINT,
    "toilets" SMALLINT,
    "max_guests" SMALLINT,
    "parking_spaces" SMALLINT,
    "furnished" BOOLEAN NOT NULL DEFAULT false,
    "serviced" BOOLEAN NOT NULL DEFAULT false,
    "price_kobo" BIGINT,
    "currency" "Currency" NOT NULL DEFAULT 'NGN',
    "caution_fee_kobo" BIGINT,
    "discount_percent" SMALLINT,
    "cleaning_option" "CleaningOption",
    "cleaning_fee_kobo" BIGINT,
    "available_from" DATE,
    "moderation_note" VARCHAR(1000),
    "submitted_at" TIMESTAMPTZ(3),
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewer_id" UUID,
    "published_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_images" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "storage_key" VARCHAR(300) NOT NULL,
    "thumbnail_key" VARCHAR(300) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "alt_text" VARCHAR(200),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_videos" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "provider" "VideoProvider" NOT NULL,
    "external_id" VARCHAR(40) NOT NULL,
    "title" VARCHAR(120),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "amenities" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "category" "AmenityCategory" NOT NULL,
    "icon" VARCHAR(40),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "amenities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_amenities" (
    "property_id" UUID NOT NULL,
    "amenity_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_amenities_pkey" PRIMARY KEY ("property_id","amenity_id")
);

-- CreateTable
CREATE TABLE "property_favorites" (
    "user_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_favorites_pkey" PRIMARY KEY ("user_id","property_id")
);

-- CreateTable
CREATE TABLE "property_view_daily" (
    "property_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "property_view_daily_pkey" PRIMARY KEY ("property_id","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "properties_slug_key" ON "properties"("slug");

-- CreateIndex
CREATE INDEX "properties_agent_profile_id_status_idx" ON "properties"("agent_profile_id", "status");

-- CreateIndex
CREATE INDEX "properties_status_published_at_idx" ON "properties"("status", "published_at" DESC);

-- CreateIndex
CREATE INDEX "properties_status_listing_type_pricing_period_idx" ON "properties"("status", "listing_type", "pricing_period");

-- CreateIndex
CREATE INDEX "properties_status_property_type_idx" ON "properties"("status", "property_type");

-- CreateIndex
CREATE INDEX "properties_status_state_city_idx" ON "properties"("status", "state", "city");

-- CreateIndex
CREATE INDEX "properties_status_price_kobo_idx" ON "properties"("status", "price_kobo");

-- CreateIndex
CREATE INDEX "properties_latitude_longitude_idx" ON "properties"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "properties_created_at_idx" ON "properties"("created_at");

-- CreateIndex
CREATE INDEX "property_images_property_id_sort_order_idx" ON "property_images"("property_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "property_videos_property_id_provider_external_id_key" ON "property_videos"("property_id", "provider", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "amenities_slug_key" ON "amenities"("slug");

-- CreateIndex
CREATE INDEX "amenities_is_active_category_sort_order_idx" ON "amenities"("is_active", "category", "sort_order");

-- CreateIndex
CREATE INDEX "property_amenities_amenity_id_idx" ON "property_amenities"("amenity_id");

-- CreateIndex
CREATE INDEX "property_favorites_property_id_idx" ON "property_favorites"("property_id");

-- CreateIndex
CREATE INDEX "property_favorites_user_id_created_at_idx" ON "property_favorites"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_agent_profile_id_fkey" FOREIGN KEY ("agent_profile_id") REFERENCES "agent_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_images" ADD CONSTRAINT "property_images_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_videos" ADD CONSTRAINT "property_videos_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_amenities" ADD CONSTRAINT "property_amenities_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_amenities" ADD CONSTRAINT "property_amenities_amenity_id_fkey" FOREIGN KEY ("amenity_id") REFERENCES "amenities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_favorites" ADD CONSTRAINT "property_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_favorites" ADD CONSTRAINT "property_favorites_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_view_daily" ADD CONSTRAINT "property_view_daily_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integrity rules the application also enforces (defence in depth).
ALTER TABLE "properties" ADD CONSTRAINT "properties_sale_period_check"
  CHECK ("pricing_period" IS NULL OR ("listing_type" = 'SALE') = ("pricing_period" = 'SALE'));
ALTER TABLE "properties" ADD CONSTRAINT "properties_money_non_negative_check"
  CHECK (COALESCE("price_kobo", 0) >= 0 AND COALESCE("caution_fee_kobo", 0) >= 0 AND COALESCE("cleaning_fee_kobo", 0) >= 0);
ALTER TABLE "properties" ADD CONSTRAINT "properties_discount_range_check"
  CHECK ("discount_percent" IS NULL OR "discount_percent" BETWEEN 1 AND 90);
-- At most one primary image per property.
CREATE UNIQUE INDEX "property_images_one_primary_idx" ON "property_images" ("property_id") WHERE "is_primary";

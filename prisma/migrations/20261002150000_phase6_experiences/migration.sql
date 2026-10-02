-- CreateEnum
CREATE TYPE "ExperienceKind" AS ENUM ('EVENT', 'TOUR', 'HOTEL', 'CLEANING');

-- CreateEnum
CREATE TYPE "ExperienceStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TicketTypeKind" AS ENUM ('REGULAR', 'VIP', 'VVIP', 'EARLY_BIRD', 'GROUP');

-- CreateEnum
CREATE TYPE "TourCategory" AS ENUM ('ZOO_TOUR', 'CITY_TOUR', 'CULTURAL_EXPERIENCE', 'ADVENTURE_ACTIVITY', 'TOURIST_ATTRACTION', 'GUIDED_TOUR');

-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN');

-- AlterEnum
ALTER TYPE "ConversationContextType" ADD VALUE 'EXPERIENCE';

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "experience_id" UUID;

-- CreateTable
CREATE TABLE "experiences" (
    "id" UUID NOT NULL,
    "kind" "ExperienceKind" NOT NULL,
    "agent_profile_id" UUID NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "status" "ExperienceStatus" NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(5000),
    "address_line" VARCHAR(240),
    "city" VARCHAR(100),
    "state" VARCHAR(60),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "moderation_note" VARCHAR(1000),
    "submitted_at" TIMESTAMPTZ(3),
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewer_id" UUID,
    "published_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "experiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experience_images" (
    "id" UUID NOT NULL,
    "experience_id" UUID NOT NULL,
    "storage_key" VARCHAR(300) NOT NULL,
    "thumbnail_key" VARCHAR(300) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "alt_text" VARCHAR(200),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experience_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experience_videos" (
    "id" UUID NOT NULL,
    "experience_id" UUID NOT NULL,
    "provider" "VideoProvider" NOT NULL,
    "external_id" VARCHAR(40) NOT NULL,
    "title" VARCHAR(120),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experience_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experience_amenities" (
    "experience_id" UUID NOT NULL,
    "amenity_id" UUID NOT NULL,

    CONSTRAINT "experience_amenities_pkey" PRIMARY KEY ("experience_id","amenity_id")
);

-- CreateTable
CREATE TABLE "events" (
    "experience_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "capacity" INTEGER,
    "organizer" VARCHAR(160),
    "terms" VARCHAR(5000),
    "hospitality" VARCHAR(2000),

    CONSTRAINT "events_pkey" PRIMARY KEY ("experience_id")
);

-- CreateTable
CREATE TABLE "event_ticket_types" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "kind" "TicketTypeKind" NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500),
    "price_kobo" BIGINT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "event_ticket_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tours" (
    "experience_id" UUID NOT NULL,
    "category" "TourCategory",
    "price_kobo" BIGINT,
    "price_note" VARCHAR(120),
    "capacity" INTEGER,

    CONSTRAINT "tours_pkey" PRIMARY KEY ("experience_id")
);

-- CreateTable
CREATE TABLE "tour_dates" (
    "id" UUID NOT NULL,
    "tour_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tour_dates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotels" (
    "experience_id" UUID NOT NULL,
    "hospitality" VARCHAR(2000),
    "food" VARCHAR(2000),
    "cleaning" VARCHAR(2000),

    CONSTRAINT "hotels_pkey" PRIMARY KEY ("experience_id")
);

-- CreateTable
CREATE TABLE "hotel_room_types" (
    "id" UUID NOT NULL,
    "hotel_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(1000),
    "max_guests" SMALLINT,
    "price_kobo" BIGINT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "hotel_room_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_rooms" (
    "id" UUID NOT NULL,
    "hotel_id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,
    "label" VARCHAR(40) NOT NULL,
    "price_kobo" BIGINT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "hotel_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_room_availability" (
    "room_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "available" BOOLEAN NOT NULL,
    "price_kobo" BIGINT,

    CONSTRAINT "hotel_room_availability_pkey" PRIMARY KEY ("room_id","date")
);

-- CreateTable
CREATE TABLE "cleaning_services" (
    "experience_id" UUID NOT NULL,
    "price_kobo" BIGINT,
    "price_note" VARCHAR(120),
    "service_areas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "available_days" "Weekday"[] DEFAULT ARRAY[]::"Weekday"[],
    "availability_note" VARCHAR(300),

    CONSTRAINT "cleaning_services_pkey" PRIMARY KEY ("experience_id")
);

-- CreateTable
CREATE TABLE "vacation_zones" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "state" VARCHAR(60),
    "description" VARCHAR(5000),
    "accommodation" VARCHAR(2000),
    "price_range_min_kobo" BIGINT,
    "price_range_max_kobo" BIGINT,
    "activities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "offers" VARCHAR(2000),
    "hospitality" VARCHAR(2000),
    "nearby_attractions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "published" BOOLEAN NOT NULL DEFAULT false,
    "cover_key" VARCHAR(300),
    "cover_thumb_key" VARCHAR(300),
    "cover_bytes" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vacation_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vacation_zone_experiences" (
    "zone_id" UUID NOT NULL,
    "experience_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "vacation_zone_experiences_pkey" PRIMARY KEY ("zone_id","experience_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "experiences_slug_key" ON "experiences"("slug");

-- CreateIndex
CREATE INDEX "experiences_agent_profile_id_kind_status_idx" ON "experiences"("agent_profile_id", "kind", "status");

-- CreateIndex
CREATE INDEX "experiences_kind_status_published_at_idx" ON "experiences"("kind", "status", "published_at" DESC);

-- CreateIndex
CREATE INDEX "experiences_kind_status_state_city_idx" ON "experiences"("kind", "status", "state", "city");

-- CreateIndex
CREATE INDEX "experience_images_experience_id_sort_order_idx" ON "experience_images"("experience_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "experience_videos_experience_id_provider_external_id_key" ON "experience_videos"("experience_id", "provider", "external_id");

-- CreateIndex
CREATE INDEX "experience_amenities_amenity_id_idx" ON "experience_amenities"("amenity_id");

-- CreateIndex
CREATE INDEX "events_starts_at_idx" ON "events"("starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "event_ticket_types_event_id_name_key" ON "event_ticket_types"("event_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "tour_dates_tour_id_starts_at_key" ON "tour_dates"("tour_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_room_types_hotel_id_name_key" ON "hotel_room_types"("hotel_id", "name");

-- CreateIndex
CREATE INDEX "hotel_rooms_room_type_id_idx" ON "hotel_rooms"("room_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_rooms_hotel_id_label_key" ON "hotel_rooms"("hotel_id", "label");

-- CreateIndex
CREATE UNIQUE INDEX "vacation_zones_slug_key" ON "vacation_zones"("slug");

-- CreateIndex
CREATE INDEX "vacation_zones_published_sort_order_idx" ON "vacation_zones"("published", "sort_order");

-- CreateIndex
CREATE INDEX "vacation_zone_experiences_experience_id_idx" ON "vacation_zone_experiences"("experience_id");

-- CreateIndex
CREATE INDEX "conversations_experience_id_idx" ON "conversations"("experience_id");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_experience_id_fkey" FOREIGN KEY ("experience_id") REFERENCES "experiences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_agent_profile_id_fkey" FOREIGN KEY ("agent_profile_id") REFERENCES "agent_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experience_images" ADD CONSTRAINT "experience_images_experience_id_fkey" FOREIGN KEY ("experience_id") REFERENCES "experiences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experience_videos" ADD CONSTRAINT "experience_videos_experience_id_fkey" FOREIGN KEY ("experience_id") REFERENCES "experiences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experience_amenities" ADD CONSTRAINT "experience_amenities_experience_id_fkey" FOREIGN KEY ("experience_id") REFERENCES "experiences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experience_amenities" ADD CONSTRAINT "experience_amenities_amenity_id_fkey" FOREIGN KEY ("amenity_id") REFERENCES "amenities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_experience_id_fkey" FOREIGN KEY ("experience_id") REFERENCES "experiences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_ticket_types" ADD CONSTRAINT "event_ticket_types_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("experience_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tours" ADD CONSTRAINT "tours_experience_id_fkey" FOREIGN KEY ("experience_id") REFERENCES "experiences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_dates" ADD CONSTRAINT "tour_dates_tour_id_fkey" FOREIGN KEY ("tour_id") REFERENCES "tours"("experience_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotels" ADD CONSTRAINT "hotels_experience_id_fkey" FOREIGN KEY ("experience_id") REFERENCES "experiences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_room_types" ADD CONSTRAINT "hotel_room_types_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("experience_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_rooms" ADD CONSTRAINT "hotel_rooms_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("experience_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_rooms" ADD CONSTRAINT "hotel_rooms_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "hotel_room_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_room_availability" ADD CONSTRAINT "hotel_room_availability_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "hotel_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaning_services" ADD CONSTRAINT "cleaning_services_experience_id_fkey" FOREIGN KEY ("experience_id") REFERENCES "experiences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacation_zones" ADD CONSTRAINT "vacation_zones_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacation_zone_experiences" ADD CONSTRAINT "vacation_zone_experiences_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "vacation_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacation_zone_experiences" ADD CONSTRAINT "vacation_zone_experiences_experience_id_fkey" FOREIGN KEY ("experience_id") REFERENCES "experiences"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ─── Hand-written: constraints Prisma cannot express ─────────────────────────

-- The one documented non-additive change: the Phase 5 context check is
-- replaced so an EXPERIENCE conversation carries exactly experience_id.
-- Existing PROPERTY/BOOKING rows have experience_id NULL and still satisfy it.
-- Compared as text: a new enum value cannot be used as an enum literal in the
-- same transaction that added it.
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_context_check";
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_context_check" CHECK (
  ("context_type"::text = 'PROPERTY' AND "property_id" IS NOT NULL AND "booking_id" IS NULL AND "experience_id" IS NULL)
  OR ("context_type"::text = 'BOOKING' AND "booking_id" IS NOT NULL AND "property_id" IS NULL AND "experience_id" IS NULL)
  OR ("context_type"::text = 'EXPERIENCE' AND "experience_id" IS NOT NULL AND "property_id" IS NULL AND "booking_id" IS NULL)
);

-- At most one primary image per listing.
CREATE UNIQUE INDEX "experience_images_one_primary_idx" ON "experience_images" ("experience_id") WHERE "is_primary";
ALTER TABLE "experience_images" ADD CONSTRAINT "experience_images_bytes_check" CHECK ("bytes" > 0);

ALTER TABLE "experiences" ADD CONSTRAINT "experiences_coordinates_check" CHECK (
  ("latitude" IS NULL) = ("longitude" IS NULL)
  AND ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90)
  AND ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180)
);

-- Catalogue prices are non-negative integer kobo.
ALTER TABLE "event_ticket_types" ADD CONSTRAINT "event_ticket_types_price_check" CHECK ("price_kobo" >= 0);
ALTER TABLE "tours" ADD CONSTRAINT "tours_price_check" CHECK ("price_kobo" IS NULL OR "price_kobo" >= 0);
ALTER TABLE "hotel_room_types" ADD CONSTRAINT "hotel_room_types_price_check" CHECK ("price_kobo" >= 0);
ALTER TABLE "hotel_rooms" ADD CONSTRAINT "hotel_rooms_price_check" CHECK ("price_kobo" IS NULL OR "price_kobo" >= 0);
ALTER TABLE "hotel_room_availability" ADD CONSTRAINT "hotel_room_availability_price_check" CHECK ("price_kobo" IS NULL OR "price_kobo" >= 0);
ALTER TABLE "cleaning_services" ADD CONSTRAINT "cleaning_services_price_check" CHECK ("price_kobo" IS NULL OR "price_kobo" >= 0);
ALTER TABLE "vacation_zones" ADD CONSTRAINT "vacation_zones_price_range_check" CHECK (
  COALESCE("price_range_min_kobo", 0) >= 0 AND COALESCE("price_range_max_kobo", 0) >= 0
  AND ("price_range_min_kobo" IS NULL OR "price_range_max_kobo" IS NULL OR "price_range_min_kobo" <= "price_range_max_kobo")
);

ALTER TABLE "events" ADD CONSTRAINT "events_time_check" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at");
ALTER TABLE "events" ADD CONSTRAINT "events_capacity_check" CHECK ("capacity" IS NULL OR "capacity" > 0);
ALTER TABLE "tours" ADD CONSTRAINT "tours_capacity_check" CHECK ("capacity" IS NULL OR "capacity" > 0);
ALTER TABLE "hotel_room_types" ADD CONSTRAINT "hotel_room_types_guests_check" CHECK ("max_guests" IS NULL OR "max_guests" > 0);

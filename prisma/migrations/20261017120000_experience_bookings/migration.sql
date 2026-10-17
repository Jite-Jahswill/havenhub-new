-- Online bookings for tours, events and hotels (paid via Paystack like
-- rentals), package items priced per day, and direct customer → agent chat.

-- CreateEnum
CREATE TYPE "PackageItemCategory" AS ENUM ('TOUR_FEE', 'ACCOMMODATION', 'FOOD', 'TRANSPORT', 'OTHER');

-- AlterEnum
ALTER TYPE "ConversationContextType" ADD VALUE 'AGENT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PriceLineKind" ADD VALUE 'PACKAGE_ITEM';
ALTER TYPE "PriceLineKind" ADD VALUE 'TICKET';
ALTER TYPE "PriceLineKind" ADD VALUE 'ROOM';

-- DropIndex
DROP INDEX "booking_line_items_booking_id_kind_key";

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "experience_id" UUID,
ADD COLUMN     "hotel_room_type_id" UUID,
ADD COLUMN     "rooms" SMALLINT,
ADD COLUMN     "selection" JSONB,
ALTER COLUMN "property_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "agent_profile_id" UUID;

-- AlterTable
ALTER TABLE "experiences" ADD COLUMN     "online_booking" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "experience_package_items" (
    "id" UUID NOT NULL,
    "experience_id" UUID NOT NULL,
    "category" "PackageItemCategory" NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(300),
    "price_kobo" BIGINT NOT NULL,
    "per_person" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "experience_package_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "experience_package_items_experience_id_name_key" ON "experience_package_items"("experience_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "booking_line_items_booking_id_sort_order_key" ON "booking_line_items"("booking_id", "sort_order");

-- CreateIndex
CREATE INDEX "bookings_experience_id_status_start_date_idx" ON "bookings"("experience_id", "status", "start_date");

-- CreateIndex
CREATE INDEX "bookings_hotel_room_type_id_status_start_date_idx" ON "bookings"("hotel_room_type_id", "status", "start_date");

-- CreateIndex
CREATE INDEX "conversations_agent_profile_id_idx" ON "conversations"("agent_profile_id");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_experience_id_fkey" FOREIGN KEY ("experience_id") REFERENCES "experiences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_hotel_room_type_id_fkey" FOREIGN KEY ("hotel_room_type_id") REFERENCES "hotel_room_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agent_profile_id_fkey" FOREIGN KEY ("agent_profile_id") REFERENCES "agent_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experience_package_items" ADD CONSTRAINT "experience_package_items_experience_id_fkey" FOREIGN KEY ("experience_id") REFERENCES "experiences"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Integrity rules Prisma cannot express ──────────────────────────────────

-- A booking is for exactly one listing: a property or an experience.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_listing_check" CHECK (
  ("property_id" IS NULL) <> ("experience_id" IS NULL)
);
-- Hotel room details only on experience bookings, and at least one room.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_rooms_check" CHECK (
  ("rooms" IS NULL OR "rooms" > 0) AND
  ("hotel_room_type_id" IS NULL OR "experience_id" IS NOT NULL)
);
ALTER TABLE "experience_package_items" ADD CONSTRAINT "experience_package_items_price_check" CHECK ("price_kobo" > 0);

-- Promo codes on tours, events, hotels and cleaning; cleaning bookings per day.

-- AlterTable
ALTER TABLE "cleaning_services" ADD COLUMN     "daily_capacity" SMALLINT;

-- AlterTable
ALTER TABLE "discount_codes" ADD COLUMN     "experience_ids" UUID[] DEFAULT ARRAY[]::UUID[];


ALTER TABLE "cleaning_services" ADD CONSTRAINT "cleaning_services_daily_capacity_check" CHECK ("daily_capacity" IS NULL OR "daily_capacity" > 0);

-- Reviews of tour, event, hotel and cleaning bookings.

-- AlterTable
ALTER TABLE "experiences" ADD COLUMN     "rating_sum" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "review_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "experience_id" UUID,
ALTER COLUMN "property_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "reviews_experience_id_status_created_at_idx" ON "reviews"("experience_id", "status", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_experience_id_fkey" FOREIGN KEY ("experience_id") REFERENCES "experiences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A review is of exactly one listing.
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_listing_check" CHECK (("property_id" IS NULL) <> ("experience_id" IS NULL));
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_rating_check" CHECK ("rating_sum" >= 0 AND "review_count" >= 0);

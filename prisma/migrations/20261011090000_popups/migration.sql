-- Admin-managed pop-up modals for the public site. Additive.

-- CreateTable
CREATE TABLE "popups" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body" VARCHAR(600),
    "image_id" UUID,
    "property_id" UUID,
    "discount_code" VARCHAR(32),
    "cta_label" VARCHAR(40),
    "cta_link" VARCHAR(500),
    "audience" VARCHAR(20) NOT NULL DEFAULT 'ALL',
    "paths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "frequency" VARCHAR(20) NOT NULL DEFAULT 'ONCE',
    "delay_seconds" INTEGER NOT NULL DEFAULT 2,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "views" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "dismissals" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "popups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "popups_active_priority_idx" ON "popups"("active", "priority" DESC);

-- AddForeignKey
ALTER TABLE "popups" ADD CONSTRAINT "popups_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "cms_media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "popups" ADD CONSTRAINT "popups_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "popups" ADD CONSTRAINT "popups_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "popups"
  ADD CONSTRAINT "popups_kind" CHECK ("kind" IN ('ANNOUNCEMENT', 'WHATS_NEW', 'OFFER', 'PROPERTY')),
  ADD CONSTRAINT "popups_audience" CHECK ("audience" IN ('ALL', 'GUESTS', 'CUSTOMERS', 'AGENTS')),
  ADD CONSTRAINT "popups_frequency" CHECK ("frequency" IN ('ONCE', 'DAILY', 'EVERY_VISIT')),
  ADD CONSTRAINT "popups_cta_link_relative" CHECK ("cta_link" IS NULL OR "cta_link" LIKE '/%'),
  ADD CONSTRAINT "popups_delay_range" CHECK ("delay_seconds" BETWEEN 0 AND 60),
  ADD CONSTRAINT "popups_counters" CHECK ("views" >= 0 AND "clicks" >= 0 AND "dismissals" >= 0),
  ADD CONSTRAINT "popups_window" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "starts_at" < "ends_at");

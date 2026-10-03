-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "HomepageSectionKey" AS ENUM ('HERO', 'EXPLORE', 'FEATURED_PROPERTIES', 'POPULAR_LOCATIONS', 'RENT_PROPERTIES', 'SALE_PROPERTIES', 'VACATION_ZONES', 'HOTELS', 'EVENTS', 'TOURS', 'CLEANING', 'SPECIAL_OFFERS', 'AWARDS', 'BLOG', 'TESTIMONIALS', 'CTA');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('NEW', 'REVIEWED', 'SHORTLISTED', 'REJECTED', 'HIRED');

-- CreateEnum
CREATE TYPE "SubscriberStatus" AS ENUM ('PENDING', 'SUBSCRIBED', 'UNSUBSCRIBED');

-- CreateEnum
CREATE TYPE "SubscriberEventType" AS ENUM ('REQUESTED', 'CONFIRMED', 'UNSUBSCRIBED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED');

-- AlterEnum
ALTER TYPE "ConversationContextType" ADD VALUE 'SUPPORT';

-- CreateTable
CREATE TABLE "site_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "site_name" VARCHAR(60) NOT NULL DEFAULT 'HavenHub',
    "tagline" VARCHAR(160),
    "logo_key" VARCHAR(300),
    "logo_width" INTEGER,
    "logo_height" INTEGER,
    "favicon_key" VARCHAR(300),
    "contact_email" VARCHAR(254),
    "contact_phone" VARCHAR(40),
    "contact_address" VARCHAR(300),
    "social_links" JSONB NOT NULL DEFAULT '[]',
    "footer_text" VARCHAR(500),
    "blog_enabled" BOOLEAN NOT NULL DEFAULT true,
    "careers_enabled" BOOLEAN NOT NULL DEFAULT false,
    "help_center_enabled" BOOLEAN NOT NULL DEFAULT false,
    "newsletter_enabled" BOOLEAN NOT NULL DEFAULT false,
    "newsletter_consent_text" VARCHAR(1000),
    "newsletter_double_opt_in" BOOLEAN NOT NULL DEFAULT true,
    "cv_retention_days" INTEGER,
    "seo_title" VARCHAR(70),
    "seo_description" VARCHAR(200),
    "seo_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "og_image_id" UUID,
    "twitter_handle" VARCHAR(16),
    "allow_indexing" BOOLEAN NOT NULL DEFAULT true,
    "robots_disallow" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sitemap_sections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homepage_sections" (
    "key" "HomepageSectionKey" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "title" VARCHAR(120),
    "subtitle" VARCHAR(300),
    "config" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "homepage_sections_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "cms_media" (
    "id" UUID NOT NULL,
    "storage_key" VARCHAR(300) NOT NULL,
    "thumbnail_key" VARCHAR(300) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "alt_text" VARCHAR(200),
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cms_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pages" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "system" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMPTZ(3),
    "seo_title" VARCHAR(70),
    "seo_description" VARCHAR(200),
    "og_image_id" UUID,
    "no_index" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_categories" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(300),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blog_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_tags" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blog_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_posts" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "excerpt" VARCHAR(400),
    "body" TEXT NOT NULL DEFAULT '',
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "publish_at" TIMESTAMPTZ(3),
    "cover_image_id" UUID,
    "category_id" UUID,
    "author_id" UUID,
    "author_name" VARCHAR(120),
    "reading_minutes" INTEGER NOT NULL DEFAULT 1,
    "seo_title" VARCHAR(70),
    "seo_description" VARCHAR(200),
    "seo_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "canonical_url" VARCHAR(500),
    "no_index" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_post_tags" (
    "post_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "blog_post_tags_pkey" PRIMARY KEY ("post_id","tag_id")
);

-- CreateTable
CREATE TABLE "blog_post_relations" (
    "post_id" UUID NOT NULL,
    "related_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "blog_post_relations_pkey" PRIMARY KEY ("post_id","related_id")
);

-- CreateTable
CREATE TABLE "help_categories" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(300),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "help_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "help_articles" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "summary" VARCHAR(300),
    "body" TEXT NOT NULL DEFAULT '',
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "category_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMPTZ(3),
    "seo_title" VARCHAR(70),
    "seo_description" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "help_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faqs" (
    "id" UUID NOT NULL,
    "question" VARCHAR(300) NOT NULL,
    "answer" TEXT NOT NULL,
    "category_id" UUID,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "testimonials" (
    "id" UUID NOT NULL,
    "quote" VARCHAR(600) NOT NULL,
    "author_name" VARCHAR(120) NOT NULL,
    "author_role" VARCHAR(120),
    "photo_id" UUID,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "testimonials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_routes" (
    "path" VARCHAR(120) NOT NULL,
    "title" VARCHAR(70),
    "description" VARCHAR(200),
    "og_image_id" UUID,
    "no_index" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seo_routes_pkey" PRIMARY KEY ("path")
);

-- CreateTable
CREATE TABLE "job_postings" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "department" VARCHAR(80),
    "location" VARCHAR(160) NOT NULL,
    "employment_type" "EmploymentType" NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "requirements" TEXT NOT NULL DEFAULT '',
    "status" "JobStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(3),
    "closes_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "seo_title" VARCHAR(70),
    "seo_description" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_applications" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "full_name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "cover_note" VARCHAR(4000),
    "cv_key" VARCHAR(300),
    "cv_file_name" VARCHAR(200) NOT NULL,
    "cv_content_type" VARCHAR(120) NOT NULL,
    "cv_bytes" INTEGER NOT NULL,
    "cv_deleted_at" TIMESTAMPTZ(3),
    "status" "ApplicationStatus" NOT NULL DEFAULT 'NEW',
    "reviewed_by_id" UUID,
    "status_changed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_subscribers" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "status" "SubscriberStatus" NOT NULL DEFAULT 'PENDING',
    "consent_text" VARCHAR(1000),
    "consent_source" VARCHAR(60),
    "consent_at" TIMESTAMPTZ(3),
    "confirmed_at" TIMESTAMPTZ(3),
    "unsubscribed_at" TIMESTAMPTZ(3),
    "confirm_token_hash" CHAR(64),
    "confirm_token_expires_at" TIMESTAMPTZ(3),
    "unsubscribe_token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_subscriber_events" (
    "id" UUID NOT NULL,
    "subscriber_id" UUID NOT NULL,
    "type" "SubscriberEventType" NOT NULL,
    "source" VARCHAR(60),
    "consent_text" VARCHAR(1000),
    "ip_hash" CHAR(64),
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_subscriber_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_campaigns" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "subject" VARCHAR(160) NOT NULL,
    "body" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduled_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_campaign_deliveries" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "subscriber_id" UUID NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "error" VARCHAR(300),
    "claimed_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_campaign_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cms_media_storage_key_key" ON "cms_media"("storage_key");

-- CreateIndex
CREATE INDEX "cms_media_created_at_idx" ON "cms_media"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "pages_slug_key" ON "pages"("slug");

-- CreateIndex
CREATE INDEX "pages_status_idx" ON "pages"("status");

-- CreateIndex
CREATE UNIQUE INDEX "blog_categories_slug_key" ON "blog_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "blog_tags_slug_key" ON "blog_tags"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "blog_posts_slug_key" ON "blog_posts"("slug");

-- CreateIndex
CREATE INDEX "blog_posts_status_publish_at_idx" ON "blog_posts"("status", "publish_at" DESC);

-- CreateIndex
CREATE INDEX "blog_posts_category_id_idx" ON "blog_posts"("category_id");

-- CreateIndex
CREATE INDEX "blog_post_tags_tag_id_idx" ON "blog_post_tags"("tag_id");

-- CreateIndex
CREATE INDEX "blog_post_relations_related_id_idx" ON "blog_post_relations"("related_id");

-- CreateIndex
CREATE UNIQUE INDEX "help_categories_slug_key" ON "help_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "help_articles_slug_key" ON "help_articles"("slug");

-- CreateIndex
CREATE INDEX "help_articles_category_id_status_sort_order_idx" ON "help_articles"("category_id", "status", "sort_order");

-- CreateIndex
CREATE INDEX "faqs_published_sort_order_idx" ON "faqs"("published", "sort_order");

-- CreateIndex
CREATE INDEX "testimonials_published_sort_order_idx" ON "testimonials"("published", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "job_postings_slug_key" ON "job_postings"("slug");

-- CreateIndex
CREATE INDEX "job_postings_status_published_at_idx" ON "job_postings"("status", "published_at" DESC);

-- CreateIndex
CREATE INDEX "job_applications_job_id_status_created_at_idx" ON "job_applications"("job_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "job_applications_created_at_idx" ON "job_applications"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "job_applications_job_id_email_key" ON "job_applications"("job_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "email_subscribers_email_key" ON "email_subscribers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "email_subscribers_confirm_token_hash_key" ON "email_subscribers"("confirm_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "email_subscribers_unsubscribe_token_hash_key" ON "email_subscribers"("unsubscribe_token_hash");

-- CreateIndex
CREATE INDEX "email_subscribers_status_idx" ON "email_subscribers"("status");

-- CreateIndex
CREATE INDEX "email_subscriber_events_subscriber_id_created_at_idx" ON "email_subscriber_events"("subscriber_id", "created_at");

-- CreateIndex
CREATE INDEX "email_campaigns_status_scheduled_at_idx" ON "email_campaigns"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "email_campaign_deliveries_campaign_id_status_idx" ON "email_campaign_deliveries"("campaign_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "email_campaign_deliveries_campaign_id_subscriber_id_key" ON "email_campaign_deliveries"("campaign_id", "subscriber_id");

-- AddForeignKey
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_og_image_id_fkey" FOREIGN KEY ("og_image_id") REFERENCES "cms_media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms_media" ADD CONSTRAINT "cms_media_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_og_image_id_fkey" FOREIGN KEY ("og_image_id") REFERENCES "cms_media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_cover_image_id_fkey" FOREIGN KEY ("cover_image_id") REFERENCES "cms_media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "blog_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_post_tags" ADD CONSTRAINT "blog_post_tags_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "blog_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_post_tags" ADD CONSTRAINT "blog_post_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "blog_tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_post_relations" ADD CONSTRAINT "blog_post_relations_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "blog_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_post_relations" ADD CONSTRAINT "blog_post_relations_related_id_fkey" FOREIGN KEY ("related_id") REFERENCES "blog_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "help_articles" ADD CONSTRAINT "help_articles_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "help_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faqs" ADD CONSTRAINT "faqs_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "help_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "cms_media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_routes" ADD CONSTRAINT "seo_routes_og_image_id_fkey" FOREIGN KEY ("og_image_id") REFERENCES "cms_media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job_postings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_subscriber_events" ADD CONSTRAINT "email_subscriber_events_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "email_subscribers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_campaign_deliveries" ADD CONSTRAINT "email_campaign_deliveries_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "email_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_campaign_deliveries" ADD CONSTRAINT "email_campaign_deliveries_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "email_subscribers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ─── Hand-written: constraints Prisma cannot express ─────────────────────────

-- The documented non-additive change: the conversation context check is
-- replaced so a SUPPORT conversation carries no listing/booking reference.
-- Existing PROPERTY/BOOKING/EXPERIENCE rows still satisfy it. Compared as
-- text: a new enum value cannot be used as a literal in its own transaction.
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_context_check";
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_context_check" CHECK (
  ("context_type"::text = 'PROPERTY' AND "property_id" IS NOT NULL AND "booking_id" IS NULL AND "experience_id" IS NULL)
  OR ("context_type"::text = 'BOOKING' AND "booking_id" IS NOT NULL AND "property_id" IS NULL AND "experience_id" IS NULL)
  OR ("context_type"::text = 'EXPERIENCE' AND "experience_id" IS NOT NULL AND "property_id" IS NULL AND "booking_id" IS NULL)
  OR ("context_type"::text = 'SUPPORT' AND "property_id" IS NULL AND "booking_id" IS NULL AND "experience_id" IS NULL)
);

-- Site settings is a single row.
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_singleton_check" CHECK ("id" = 1);
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_retention_check"
  CHECK ("cv_retention_days" IS NULL OR "cv_retention_days" BETWEEN 1 AND 3650);

ALTER TABLE "cms_media" ADD CONSTRAINT "cms_media_bytes_check" CHECK ("bytes" > 0);
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_cv_check"
  CHECK ("cv_bytes" > 0 AND (("cv_key" IS NULL) = ("cv_deleted_at" IS NOT NULL)));
ALTER TABLE "blog_post_relations" ADD CONSTRAINT "blog_post_relations_self_check"
  CHECK ("post_id" <> "related_id");
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_reading_check" CHECK ("reading_minutes" >= 1);
-- A published post always has a publication time.
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_publish_check"
  CHECK ("status" <> 'PUBLISHED' OR "publish_at" IS NOT NULL);

-- Full-text search (the queries use these exact expressions).
CREATE INDEX "blog_posts_search_idx" ON "blog_posts" USING GIN (
  (setweight(to_tsvector('english', "title"), 'A')
   || setweight(to_tsvector('english', coalesce("excerpt", '')), 'B')
   || setweight(to_tsvector('english', "body"), 'C'))
);
CREATE INDEX "help_articles_search_idx" ON "help_articles" USING GIN (
  (setweight(to_tsvector('english', "title"), 'A')
   || setweight(to_tsvector('english', coalesce("summary", '')), 'B')
   || setweight(to_tsvector('english', "body"), 'C'))
);

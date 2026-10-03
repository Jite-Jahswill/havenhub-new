-- AlterEnum
ALTER TYPE "SubscriberEventType" ADD VALUE 'ERASED';

-- AlterTable
ALTER TABLE "email_subscribers" ADD COLUMN     "erased_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "site_settings" ADD COLUMN     "newsletter_retention_days" INTEGER;

-- Hand-written: retention periods are 1–3650 days when set.
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_newsletter_retention_check"
  CHECK ("newsletter_retention_days" IS NULL OR "newsletter_retention_days" BETWEEN 1 AND 3650);

-- Hand-written: an anonymised subscriber can never receive campaigns again.
ALTER TABLE "email_subscribers" ADD CONSTRAINT "email_subscribers_erased_check"
  CHECK ("erased_at" IS NULL OR "status" <> 'SUBSCRIBED');

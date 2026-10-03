-- CreateEnum
CREATE TYPE "SmtpSecurity" AS ENUM ('TLS', 'STARTTLS');

-- CreateTable
CREATE TABLE "smtp_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "host" VARCHAR(253) NOT NULL,
    "port" INTEGER NOT NULL,
    "security" "SmtpSecurity" NOT NULL,
    "username" VARCHAR(254),
    "password_ciphertext" VARCHAR(1024),
    "from_email" VARCHAR(254) NOT NULL,
    "from_name" VARCHAR(100) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "smtp_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "maintenance_enabled" BOOLEAN NOT NULL DEFAULT false,
    "maintenance_message" VARCHAR(500),
    "maintenance_return_text" VARCHAR(200),
    "maintenance_updated_at" TIMESTAMPTZ(3),
    "review_properties" BOOLEAN NOT NULL DEFAULT true,
    "review_events" BOOLEAN NOT NULL DEFAULT true,
    "review_tours" BOOLEAN NOT NULL DEFAULT true,
    "review_hotels" BOOLEAN NOT NULL DEFAULT true,
    "review_cleaning" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "smtp_settings" ADD CONSTRAINT "smtp_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── Hand-written ──

-- Singletons.
ALTER TABLE "smtp_settings" ADD CONSTRAINT "smtp_settings_singleton_check" CHECK ("id" = 1);
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_singleton_check" CHECK ("id" = 1);

-- Database-managed SMTP may only use mail ports.
ALTER TABLE "smtp_settings" ADD CONSTRAINT "smtp_settings_port_check"
  CHECK ("port" IN (25, 465, 587, 2525));

-- The platform settings row always exists (defaults: no maintenance, review required everywhere).
INSERT INTO "platform_settings" ("id", "updated_at") VALUES (1, now()) ON CONFLICT ("id") DO NOTHING;

-- Audit entries are append-only. The one permitted change is the foreign key's
-- ON DELETE SET NULL when the acting user is deleted: actor_id becomes NULL
-- and nothing else may change.
CREATE FUNCTION "forbid_audit_log_mutation"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."actor_id" IS NOT NULL
     AND NEW."actor_id" IS NULL
     AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_logs are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "forbid_audit_log_mutation"();

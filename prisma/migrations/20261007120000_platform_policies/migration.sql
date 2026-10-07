-- Admin-configurable platform policies. Additive: `{}` means every area uses
-- its built-in default, which is the behaviour before this migration.
ALTER TABLE "platform_settings" ADD COLUMN "policies" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "policies_updated_at" TIMESTAMPTZ(3);

ALTER TABLE "platform_settings"
  ADD CONSTRAINT "platform_settings_policies_object" CHECK (jsonb_typeof("policies") = 'object');

-- How sale listings are bought (in app or by contacting the agent) and the
-- record of buyers accepting the off-platform notice. Additive.

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "sale_mode" VARCHAR(20);

-- CreateTable
CREATE TABLE "sale_contact_acceptances" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "disclaimer_text" VARCHAR(5000) NOT NULL,
    "disclaimer_hash" CHAR(64) NOT NULL,
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(512),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_contact_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sale_contact_acceptances_property_id_created_at_idx" ON "sale_contact_acceptances"("property_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "sale_contact_acceptances_user_id_created_at_idx" ON "sale_contact_acceptances"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "sale_contact_acceptances" ADD CONSTRAINT "sale_contact_acceptances_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_contact_acceptances" ADD CONSTRAINT "sale_contact_acceptances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing sale listings are contact-for-sale; rentals have no sale mode.
UPDATE "properties" SET "sale_mode" = 'CONTACT' WHERE "listing_type" = 'SALE';
ALTER TABLE "properties"
  ADD CONSTRAINT "properties_sale_mode" CHECK (
    ("listing_type" = 'SALE' AND "sale_mode" IN ('IN_APP', 'CONTACT'))
    OR ("listing_type" <> 'SALE' AND "sale_mode" IS NULL)
  );
-- Evidence is never edited or deleted.
CREATE FUNCTION "forbid_sale_contact_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'sale_contact_acceptances are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sale_contact_acceptances_append_only"
  BEFORE UPDATE OR DELETE ON "sale_contact_acceptances"
  FOR EACH ROW EXECUTE FUNCTION "forbid_sale_contact_mutation"();

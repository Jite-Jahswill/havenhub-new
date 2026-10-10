-- Property sales never go through HavenHub: buyers deal with the agent
-- directly, so listings no longer have a sale mode. Rentals are unaffected.
-- sale_contact_acceptances is kept (append-only evidence already recorded).

ALTER TABLE "properties" DROP CONSTRAINT "properties_sale_mode";

-- AlterTable
ALTER TABLE "properties" DROP COLUMN "sale_mode";

-- Agency fee on rentals: charged to the customer, paid in full to the agent.
-- Additive: existing pricing versions and bookings have no agency fee (0).

-- AlterEnum
ALTER TYPE "LedgerEntryType" ADD VALUE 'AGENT_AGENCY_FEE_PAYABLE';

-- AlterEnum
ALTER TYPE "PriceLineKind" ADD VALUE 'AGENCY_FEE';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "agency_fee_kobo" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "pricing_configs" ADD COLUMN     "agency_fee_bps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "agency_fee_periods" "PricingPeriod"[] DEFAULT ARRAY[]::"PricingPeriod"[];

ALTER TABLE "pricing_configs"
  ADD CONSTRAINT "pricing_configs_agency_fee_range" CHECK ("agency_fee_bps" BETWEEN 0 AND 5000),
  ADD CONSTRAINT "pricing_configs_agency_fee_rentals_only" CHECK (NOT ('SALE' = ANY ("agency_fee_periods")));
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_agency_fee_non_negative" CHECK ("agency_fee_kobo" >= 0);

-- The customer total and the agent's share now include the agency fee.
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_total_check";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_total_check" CHECK (
  "total_kobo" = "stay_kobo" + "cleaning_kobo" + "caution_kobo" + "service_fee_kobo" + "vat_kobo" + "agency_fee_kobo"
);
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_agent_payout_check";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_agent_payout_check" CHECK (
  "agent_payout_kobo" = "stay_kobo" + "cleaning_kobo" + "agency_fee_kobo" - "agent_commission_kobo"
);

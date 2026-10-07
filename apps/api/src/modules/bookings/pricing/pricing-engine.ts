import { CleaningOption, PriceLineKind, stayUnitLabel, type RentalPeriod } from '@havenhub/shared';

/**
 * The one place booking prices are calculated. Pure and synchronous: every
 * amount is integer kobo held in `bigint`, so no floating point ever touches
 * money and large yearly totals cannot lose precision.
 *
 *   rent            unit price × quantity
 *   listing discount  −(unit − discounted unit) × quantity
 *   promo code        −the agent's promo discount on the rent after the listing discount
 *   = stay           (both discounts are agent-funded: fees and commission follow the stay)
 *   + cleaning        if offered for a fee and selected (once per booking)
 *   + caution         refundable deposit (once per booking; never revenue)
 *   + service fee     serviceFeeBps of the stay           → HavenHub
 *   + VAT             vatBps of the VAT base               → held for remittance
 *   = customer total
 *
 *   agent payout = stay − commission (agentCommissionBps of the stay) + cleaning
 */

export interface PricingRates {
  serviceFeeBps: number;
  agentCommissionBps: number;
  vatBps: number;
  vatOnServiceFee: boolean;
  vatOnStay: boolean;
}

export interface PricingInput {
  period: RentalPeriod;
  quantity: number;
  unitPriceKobo: bigint;
  discountPercent: number | null;
  cleaningOption: CleaningOption | null;
  cleaningFeeKobo: bigint | null;
  addCleaning: boolean;
  cautionFeeKobo: bigint | null;
  /** An agent promo code already validated (DiscountsService); amount in kobo. */
  promo?: { code: string; label: string; amountOffKobo: bigint } | null;
  rates: PricingRates;
}

export interface PricedLine {
  kind: PriceLineKind;
  label: string;
  quantity: number | null;
  unitAmountKobo: bigint | null;
  amountKobo: bigint;
}

export interface PricingResult {
  lines: PricedLine[];
  rentKobo: bigint;
  discountKobo: bigint;
  promoKobo: bigint;
  /** Rent after the listing discount and any promo code. */
  stayKobo: bigint;
  cleaningKobo: bigint;
  cautionKobo: bigint;
  serviceFeeKobo: bigint;
  vatKobo: bigint;
  totalKobo: bigint;
  agentCommissionKobo: bigint;
  agentPayoutKobo: bigint;
}

export class PricingError extends Error {}

/** amount × bps / 10 000, rounded half up. Amounts are never negative here. */
export function applyBps(amount: bigint, bps: number): bigint {
  if (amount < 0n) throw new PricingError('Rates apply to non-negative amounts only');
  return (amount * BigInt(bps) + 5_000n) / 10_000n;
}

/** Unit price after a whole-percent listing discount, rounded half up (matches the listing display). */
export function discountedUnit(unit: bigint, percent: number | null): bigint {
  if (!percent) return unit;
  return (unit * BigInt(100 - percent) + 50n) / 100n;
}

export function priceStay(input: PricingInput): PricingResult {
  const { rates } = input;
  if (input.unitPriceKobo <= 0n) throw new PricingError('This property has no price');
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new PricingError('Quantity must be a positive whole number');
  }
  const qty = BigInt(input.quantity);
  const lines: PricedLine[] = [];

  const rentKobo = input.unitPriceKobo * qty;
  lines.push({
    kind: PriceLineKind.RENT,
    label: `Rent (${stayUnitLabel(input.period, input.quantity)})`,
    quantity: input.quantity,
    unitAmountKobo: input.unitPriceKobo,
    amountKobo: rentKobo,
  });

  const unitDiscount =
    input.unitPriceKobo - discountedUnit(input.unitPriceKobo, input.discountPercent);
  const discountKobo = unitDiscount * qty;
  if (discountKobo > 0n) {
    lines.push({
      kind: PriceLineKind.LISTING_DISCOUNT,
      label: `Listing discount (${input.discountPercent}%)`,
      quantity: input.quantity,
      unitAmountKobo: -unitDiscount,
      amountKobo: -discountKobo,
    });
  }
  const promoKobo = input.promo?.amountOffKobo ?? 0n;
  if (promoKobo < 0n || (promoKobo > 0n && promoKobo >= rentKobo - discountKobo)) {
    throw new PricingError('A promo code cannot exceed the rent');
  }
  if (input.promo && promoKobo > 0n) {
    lines.push(
      fixedLine(
        PriceLineKind.PROMO_DISCOUNT,
        `Promo code ${input.promo.code} (${input.promo.label})`,
        -promoKobo,
      ),
    );
  }
  const stayKobo = rentKobo - discountKobo - promoKobo;

  let cleaningKobo = 0n;
  if (input.addCleaning) {
    if (input.cleaningOption !== CleaningOption.AVAILABLE_FOR_FEE || !input.cleaningFeeKobo) {
      throw new PricingError('This property does not offer paid cleaning');
    }
    cleaningKobo = input.cleaningFeeKobo;
    lines.push(fixedLine(PriceLineKind.CLEANING_FEE, 'Cleaning fee', cleaningKobo));
  }

  const cautionKobo = input.cautionFeeKobo && input.cautionFeeKobo > 0n ? input.cautionFeeKobo : 0n;
  if (cautionKobo > 0n) {
    lines.push(fixedLine(PriceLineKind.CAUTION_FEE, 'Caution fee (refundable)', cautionKobo));
  }

  const serviceFeeKobo = applyBps(stayKobo, rates.serviceFeeBps);
  if (serviceFeeKobo > 0n) {
    lines.push(fixedLine(PriceLineKind.SERVICE_FEE, 'HavenHub service fee', serviceFeeKobo));
  }

  const vatBase =
    (rates.vatOnServiceFee ? serviceFeeKobo : 0n) +
    (rates.vatOnStay ? stayKobo + cleaningKobo : 0n);
  const vatKobo = applyBps(vatBase, rates.vatBps);
  if (vatKobo > 0n) {
    lines.push(fixedLine(PriceLineKind.VAT, `VAT (${formatBps(rates.vatBps)})`, vatKobo));
  }

  const totalKobo = stayKobo + cleaningKobo + cautionKobo + serviceFeeKobo + vatKobo;
  const agentCommissionKobo = applyBps(stayKobo, rates.agentCommissionBps);
  const agentPayoutKobo = stayKobo - agentCommissionKobo + cleaningKobo;

  // Invariants the database also enforces (bookings_total_check / agent_payout_check).
  const lineSum = lines.reduce((sum, line) => sum + line.amountKobo, 0n);
  if (lineSum !== totalKobo) throw new PricingError('Price lines do not add up to the total');
  if (agentPayoutKobo < 0n) throw new PricingError('Agent payout cannot be negative');

  return {
    lines,
    rentKobo,
    discountKobo,
    promoKobo,
    stayKobo,
    cleaningKobo,
    cautionKobo,
    serviceFeeKobo,
    vatKobo,
    totalKobo,
    agentCommissionKobo,
    agentPayoutKobo,
  };
}

const fixedLine = (kind: PriceLineKind, label: string, amountKobo: bigint): PricedLine => ({
  kind,
  label,
  quantity: null,
  unitAmountKobo: null,
  amountKobo,
});

/** 750 → "7.5%", 1000 → "10%". */
export function formatBps(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const fraction = String(bps % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}%` : `${whole}%`;
}

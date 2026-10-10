import { describe, expect, it } from 'vitest';

import { QA_PRICING_RATES } from '../../../../test/fixtures/qa-pricing-rates';

import {
  PricingError,
  applyBps,
  discountedUnit,
  formatBps,
  priceStay,
  type PricingInput,
  type PricingRates,
} from './pricing-engine';

// Development/QA rates (10% fee, 5% commission, 7.5% VAT) — not production rates.
const rates: PricingRates = QA_PRICING_RATES;

const base = (overrides: Partial<PricingInput> = {}): PricingInput => ({
  period: 'DAILY',
  quantity: 3,
  unitPriceKobo: 5_000_000n, // ₦50,000 a night
  discountPercent: null,
  cleaningOption: 'NOT_AVAILABLE',
  cleaningFeeKobo: null,
  addCleaning: false,
  cautionFeeKobo: null,
  rates,
  ...overrides,
});

const sum = (r: ReturnType<typeof priceStay>) => r.lines.reduce((s, l) => s + l.amountKobo, 0n);

describe('priceStay', () => {
  it('daily: nights × nightly rate plus fee and VAT on the fee', () => {
    const r = priceStay(base());
    expect(r.rentKobo).toBe(15_000_000n);
    expect(r.stayKobo).toBe(15_000_000n);
    expect(r.serviceFeeKobo).toBe(1_500_000n); // 10% of ₦150,000
    expect(r.vatKobo).toBe(112_500n); // 7.5% of ₦15,000
    expect(r.totalKobo).toBe(16_612_500n);
    expect(r.agentCommissionKobo).toBe(750_000n);
    expect(r.agentPayoutKobo).toBe(14_250_000n);
    expect(r.lines.map((l) => l.kind)).toEqual(['RENT', 'SERVICE_FEE', 'VAT']);
    expect(r.lines[0]!.label).toBe('Rent (3 nights)');
    expect(sum(r)).toBe(r.totalKobo);
  });

  it('monthly: months × monthly rate', () => {
    const r = priceStay(base({ period: 'MONTHLY', quantity: 6, unitPriceKobo: 35_000_000n }));
    expect(r.rentKobo).toBe(210_000_000n);
    expect(r.lines[0]!.label).toBe('Rent (6 months)');
    expect(r.totalKobo).toBe(210_000_000n + 21_000_000n + 1_575_000n);
  });

  it('yearly: years × yearly rate, staying exact beyond 2^53 kobo', () => {
    const r = priceStay(
      base({
        period: 'YEARLY',
        quantity: 5,
        unitPriceKobo: 9_000_000_000_000_001n, // deliberately not float-representable
        rates: { ...rates, serviceFeeBps: 0, vatBps: 0 },
      }),
    );
    expect(r.rentKobo).toBe(45_000_000_000_000_005n);
    expect(r.totalKobo).toBe(45_000_000_000_000_005n);
    expect(r.lines[0]!.label).toBe('Rent (5 years)');
  });

  it('applies the listing discount per unit, as the listing displays it', () => {
    // ₦33,333.33 at 15% off = ₦28,333.33 (2,833,333.05 rounds to 2,833,333).
    const r = priceStay(base({ unitPriceKobo: 3_333_333n, discountPercent: 15, quantity: 3 }));
    expect(discountedUnit(3_333_333n, 15)).toBe(2_833_333n);
    const discount = r.lines.find((l) => l.kind === 'LISTING_DISCOUNT')!;
    expect(discount.amountKobo).toBe(-1_500_000n);
    expect(discount.label).toBe('Listing discount (15%)');
    expect(r.stayKobo).toBe(8_499_999n);
    expect(sum(r)).toBe(r.totalKobo);
  });

  it('adds cleaning once when offered for a fee and selected', () => {
    const r = priceStay(
      base({ cleaningOption: 'AVAILABLE_FOR_FEE', cleaningFeeKobo: 1_000_000n, addCleaning: true }),
    );
    expect(r.cleaningKobo).toBe(1_000_000n);
    expect(r.lines.find((l) => l.kind === 'CLEANING_FEE')!.amountKobo).toBe(1_000_000n);
    // No commission on cleaning: the agent receives all of it.
    expect(r.agentPayoutKobo).toBe(15_000_000n - 750_000n + 1_000_000n);
    expect(sum(r)).toBe(r.totalKobo);
  });

  it('refuses cleaning the property does not sell', () => {
    for (const cleaningOption of ['INCLUDED', 'CUSTOMER_MUST_CLEAN', 'NOT_AVAILABLE'] as const) {
      expect(() => priceStay(base({ cleaningOption, addCleaning: true }))).toThrow(PricingError);
    }
  });

  it('keeps the caution deposit separate from fees, VAT and agent payout', () => {
    const without = priceStay(base());
    const r = priceStay(base({ cautionFeeKobo: 10_000_000n }));
    expect(r.cautionKobo).toBe(10_000_000n);
    expect(r.lines.find((l) => l.kind === 'CAUTION_FEE')!.label).toMatch(/refundable/);
    expect(r.serviceFeeKobo).toBe(without.serviceFeeKobo);
    expect(r.vatKobo).toBe(without.vatKobo);
    expect(r.agentPayoutKobo).toBe(without.agentPayoutKobo);
    expect(r.totalKobo).toBe(without.totalKobo + 10_000_000n);
  });

  it('can charge VAT on the stay as well as the fee', () => {
    const r = priceStay(
      base({
        rates: { ...rates, vatOnStay: true },
        cleaningOption: 'AVAILABLE_FOR_FEE',
        cleaningFeeKobo: 1_000_000n,
        addCleaning: true,
      }),
    );
    // 7.5% of (fee ₦15,000 + stay ₦150,000 + cleaning ₦10,000)
    expect(r.vatKobo).toBe(1_312_500n);
    expect(r.lines.find((l) => l.kind === 'VAT')!.label).toBe('VAT (7.5%)');
  });

  it('omits zero-rate lines entirely', () => {
    const r = priceStay(
      base({ rates: { ...rates, serviceFeeBps: 0, agentCommissionBps: 0, vatBps: 0 } }),
    );
    expect(r.lines.map((l) => l.kind)).toEqual(['RENT']);
    expect(r.totalKobo).toBe(r.stayKobo);
    expect(r.agentPayoutKobo).toBe(r.stayKobo);
  });

  it('total always equals payout + HavenHub + VAT + caution', () => {
    for (const unit of [1n, 99n, 101n, 3_333_333n, 123_456_789n]) {
      for (const pct of [null, 1, 33, 90]) {
        const r = priceStay(
          base({
            unitPriceKobo: unit,
            discountPercent: pct,
            cautionFeeKobo: 777n,
            rates: { ...rates, vatOnStay: true, serviceFeeBps: 1234, agentCommissionBps: 4321 },
          }),
        );
        expect(
          r.agentPayoutKobo + r.serviceFeeKobo + r.agentCommissionKobo + r.vatKobo + r.cautionKobo,
        ).toBe(r.totalKobo);
        expect(sum(r)).toBe(r.totalKobo);
        for (const line of r.lines) expect(typeof line.amountKobo).toBe('bigint');
      }
    }
  });

  it('takes an agent promo code off after the listing discount; fees follow the reduced stay', () => {
    const r = priceStay(
      base({
        unitPriceKobo: 1_000_000n,
        discountPercent: 10,
        quantity: 2,
        promo: { code: 'STAY10', label: '10% off', amountOffKobo: 180_000n },
      }),
    );
    expect(r.rentKobo).toBe(2_000_000n);
    expect(r.discountKobo).toBe(200_000n);
    expect(r.promoKobo).toBe(180_000n);
    expect(r.stayKobo).toBe(1_620_000n);
    const promo = r.lines.find((l) => l.kind === 'PROMO_DISCOUNT')!;
    expect(promo).toMatchObject({ amountKobo: -180_000n, label: 'Promo code STAY10 (10% off)' });
    expect(r.serviceFeeKobo).toBe(applyBps(1_620_000n, rates.serviceFeeBps));
    expect(r.agentCommissionKobo).toBe(applyBps(1_620_000n, rates.agentCommissionBps));
    expect(sum(r)).toBe(r.totalKobo);
  });

  it('refuses a promo that would take the whole stay', () => {
    expect(() =>
      priceStay(
        base({
          unitPriceKobo: 100_000n,
          quantity: 1,
          promo: { code: 'ALL', label: '₦1,000 off', amountOffKobo: 100_000n },
        }),
      ),
    ).toThrow(PricingError);
  });

  it('adds the agency fee on the stay, for listed periods only, all of it to the agent', () => {
    const withFee = { ...rates, agencyFeeBps: 1000, agencyFeePeriods: ['MONTHLY', 'YEARLY'] };
    const yearly = priceStay(
      base({
        period: 'YEARLY',
        quantity: 1,
        unitPriceKobo: 300_000_000n,
        discountPercent: 10,
        rates: withFee,
      }),
    );
    // Stay after the 10% listing discount: 270,000,000; agency fee 10% of that.
    expect(yearly.stayKobo).toBe(270_000_000n);
    expect(yearly.agencyFeeKobo).toBe(27_000_000n);
    expect(yearly.lines.find((l) => l.kind === 'AGENCY_FEE')).toMatchObject({
      label: 'Agency fee (10%)',
      amountKobo: 27_000_000n,
    });
    // No commission or VAT on it: the agent gets all of it.
    expect(yearly.agentCommissionKobo).toBe(applyBps(270_000_000n, rates.agentCommissionBps));
    expect(yearly.agentPayoutKobo).toBe(270_000_000n - yearly.agentCommissionKobo + 27_000_000n);
    expect(yearly.vatKobo).toBe(applyBps(yearly.serviceFeeKobo, rates.vatBps));
    expect(sum(yearly)).toBe(yearly.totalKobo);
    expect(
      yearly.agentPayoutKobo + yearly.serviceFeeKobo + yearly.agentCommissionKobo + yearly.vatKobo,
    ).toBe(yearly.totalKobo);

    // Not for nightly stays here (period not listed), and never when the rate is 0.
    const nightly = priceStay(base({ rates: withFee }));
    expect(nightly.agencyFeeKobo).toBe(0n);
    expect(nightly.lines.some((l) => l.kind === 'AGENCY_FEE')).toBe(false);
    const off = priceStay(
      base({ period: 'YEARLY', quantity: 1, rates: { ...withFee, agencyFeeBps: 0 } }),
    );
    expect(off.agencyFeeKobo).toBe(0n);
  });

  it('rejects unpriced properties and bad quantities', () => {
    expect(() => priceStay(base({ unitPriceKobo: 0n }))).toThrow(PricingError);
    expect(() => priceStay(base({ quantity: 0 }))).toThrow(PricingError);
    expect(() => priceStay(base({ quantity: 1.5 }))).toThrow(PricingError);
  });
});

describe('kobo precision', () => {
  it('rounds percentages half up in integer kobo', () => {
    expect(applyBps(10_005n, 750)).toBe(750n); // 750.375 → 750
    expect(applyBps(10_010n, 750)).toBe(751n); // 750.75 → 751
    expect(applyBps(2n, 2500)).toBe(1n); // 0.5 → 1
    expect(applyBps(0n, 750)).toBe(0n);
    expect(() => applyBps(-1n, 750)).toThrow(PricingError);
  });

  it('formats basis points', () => {
    expect(formatBps(750)).toBe('7.5%');
    expect(formatBps(1000)).toBe('10%');
    expect(formatBps(1234)).toBe('12.34%');
    expect(formatBps(5)).toBe('0.05%');
  });
});

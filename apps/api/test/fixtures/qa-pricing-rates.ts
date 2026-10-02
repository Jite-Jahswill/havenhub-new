/**
 * ⚠️ DEVELOPMENT / QA VALUES ONLY — NOT APPROVED PRODUCTION RATES.
 *
 *   service fee 10% · agent commission 5% · VAT 7.5% on the service fee
 *
 * These numbers exist so tests and local QA have realistic, easy-to-check
 * arithmetic. HavenHub's real rates have not been approved. The application
 * has no built-in rates at all: bookings stay closed until a finance
 * administrator saves a configuration (`/admin/payments` → Commission & VAT),
 * and that configuration — never this file — is what production charges.
 *
 * Do not import this from `src/` application code, the seed script, or any
 * default. It lives under `test/` so it is never part of the API build.
 */
export const QA_PRICING_RATES = Object.freeze({
  serviceFeeBps: 1000,
  agentCommissionBps: 500,
  vatBps: 750,
  vatOnServiceFee: true,
  vatOnStay: false,
  note: 'DEVELOPMENT/QA rates — not approved for production',
});

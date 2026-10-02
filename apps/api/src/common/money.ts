/**
 * Kobo amounts are `bigint` in the database and pricing engine and plain
 * numbers on the wire. Conversion refuses anything a JSON number cannot hold
 * exactly rather than silently rounding money.
 */
export function koboToNumber(kobo: bigint): number {
  if (kobo > BigInt(Number.MAX_SAFE_INTEGER) || kobo < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError('Amount exceeds the safe integer range');
  }
  return Number(kobo);
}

export const isSafeKobo = (kobo: bigint): boolean =>
  kobo <= BigInt(Number.MAX_SAFE_INTEGER) && kobo >= BigInt(Number.MIN_SAFE_INTEGER);

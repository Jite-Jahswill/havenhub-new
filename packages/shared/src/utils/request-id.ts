/** Header carrying the request (correlation) id, end to end. */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * A request id is accepted only when it is a short, plain token: letters,
 * digits and `._:-`, 8–128 characters (UUIDs, Vercel's `x-vercel-id`). Anything
 * else — oversized, spaces, newlines, quotes — is ignored and a new id is
 * generated, so ids can never inject into or bloat log lines.
 */
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export function parseRequestId(value: unknown): string | null {
  return typeof value === 'string' && REQUEST_ID.test(value) ? value : null;
}

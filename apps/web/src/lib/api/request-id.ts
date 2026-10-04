import { parseRequestId, REQUEST_ID_HEADER } from '@havenhub/shared';

/**
 * Correlates a page request with the API calls it makes: the incoming
 * X-Request-Id (if well-formed), else Vercel's own request id. The API
 * validates it again and uses it as its request id, so one id appears in
 * both apps' logs. Only an identifier — never trusted for anything else.
 */
export function requestIdHeaders(incoming: Headers): Record<string, string> {
  const id =
    parseRequestId(incoming.get(REQUEST_ID_HEADER)) ?? parseRequestId(incoming.get('x-vercel-id'));
  return id ? { [REQUEST_ID_HEADER]: id } : {};
}

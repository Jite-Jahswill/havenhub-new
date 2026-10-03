import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * Admin-entered SMTP hosts are untrusted network destinations: without a
 * check, "test this SMTP server" becomes a way to probe the API's private
 * network. Every address a host resolves to must be public unicast; the
 * connection is then made to that checked address (not re-resolved), so DNS
 * rebinding cannot swap in an internal one.
 */
// Two lists: Node checks IPv4 addresses against IPv6 rules in their mapped
// form, so a single list with ::ffff:0:0/96 would block every IPv4 address.
const BLOCKED_V4 = new BlockList();
const BLOCKED_V6 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (cloud metadata)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
] as const) {
  BLOCKED_V4.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['64:ff9b::', 96], // NAT64
  ['100::', 64], // discard
  ['2001::', 23], // IETF protocol assignments
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  BLOCKED_V6.addSubnet(network, prefix, 'ipv6');
}

export class SmtpDestinationError extends Error {
  constructor() {
    super('This SMTP server address is not allowed.');
    this.name = 'SmtpDestinationError';
  }
}

/** True for loopback, private, link-local, reserved and other non-public addresses. */
export function isForbiddenAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return BLOCKED_V4.check(address, 'ipv4');
  if (family === 6) {
    // The IPv4 list also matches IPv4-mapped IPv6 addresses (::ffff:10.0.0.1, ::ffff:a00:1).
    return BLOCKED_V6.check(address, 'ipv6') || BLOCKED_V4.check(address, 'ipv6');
  }
  return true;
}

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;

export const systemResolver: Resolver = (host) => lookup(host, { all: true, verbatim: true });

/**
 * Resolves `host` and returns one public address to connect to. Refuses
 * when ANY resolved address is non-public (a mixed answer is suspicious).
 */
export async function resolvePublicAddress(
  host: string,
  resolve: Resolver = systemResolver,
): Promise<string> {
  if (isIP(host)) {
    if (isForbiddenAddress(host)) throw new SmtpDestinationError();
    return host;
  }
  let answers: { address: string }[];
  try {
    answers = await resolve(host);
  } catch {
    throw Object.assign(new Error('The SMTP server name could not be resolved.'), {
      code: 'EDNS',
    });
  }
  if (!answers.length || answers.some((a) => isForbiddenAddress(a.address))) {
    throw new SmtpDestinationError();
  }
  return answers[0]!.address;
}

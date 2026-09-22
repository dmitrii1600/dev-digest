import { isIP } from 'node:net';
import { ValidationError } from '../../platform/errors.js';

/**
 * Pure SSRF guard for the URL importer. A skill URL must be a public http(s)
 * host: no loopback, private, link-local, unique-local or unspecified
 * address, and no `localhost`-style names. `isBlockedIp` is exported so the
 * fetcher can re-check every DNS answer and every redirect hop.
 */

const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain']);

function ipv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return parts as [number, number, number, number];
}

function isBlockedIpv4(ip: string): boolean {
  const o = ipv4Octets(ip);
  if (!o) return true; // unparsable — fail closed
  const [a, b] = o;
  if (a === 0) return true; // 0.0.0.0/8 "this" network
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (cloud metadata lives here)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 carrier-grade NAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/** Lower-case, strip brackets, and unwrap an IPv4-mapped tail into dotted form. */
function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (lower === '::' || lower === '::1') return true;
  // ::ffff:a.b.c.d (dotted) or ::ffff:XXXX:XXXX (hex) — IPv4-mapped.
  const mappedDotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mappedDotted) return isBlockedIpv4(mappedDotted[1]!);
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1]!, 16);
    const lo = parseInt(mappedHex[2]!, 16);
    return isBlockedIpv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  const first = lower.split(':')[0] ?? '';
  if (/^fe[89ab]/.test(first)) return true; // fe80::/10 link-local
  if (/^f[cd]/.test(first)) return true; // fc00::/7 unique-local
  if (/^ff/.test(first)) return true; // multicast
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, '');
  const kind = isIP(bare);
  if (kind === 4) return isBlockedIpv4(bare);
  if (kind === 6) return isBlockedIpv6(bare);
  return true; // not an IP at all — callers only pass resolved addresses
}

export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h.length === 0) return true;
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  return false;
}

/** Parse and validate; throws a 422 `ValidationError` for anything not public http(s). */
export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError(`Not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationError(`Only http(s) URLs can be imported (got ${url.protocol})`);
  }
  if (url.username || url.password) {
    throw new ValidationError('URLs with embedded credentials are not allowed');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isBlockedHostname(host)) {
    throw new ValidationError(`Refusing to fetch a local or internal host: ${url.hostname}`);
  }
  if (isIP(host) && isBlockedIp(host)) {
    throw new ValidationError(`Refusing to fetch a private or reserved address: ${url.hostname}`);
  }
  return url;
}

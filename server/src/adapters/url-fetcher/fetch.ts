import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { FetchedResource, UrlFetchOptions, UrlFetcher } from '@devdigest/shared';
import { ExternalServiceError, ValidationError } from '../../platform/errors.js';
import { assertPublicHttpUrl, isBlockedIp } from './guard.js';

/**
 * `UrlFetcher` on the global `fetch`. Redirects are followed by hand so every
 * hop goes back through the guard (a public URL that 302s to
 * `169.254.169.254` is the classic SSRF), the body is streamed and aborted
 * past `maxBytes`, and the whole thing is bounded by one timeout.
 *
 * Known gap, accepted: the DNS check happens before `fetch` resolves the name
 * itself, so a rebinding host could answer differently twice. Pinning the
 * address would need a custom dispatcher; out of scope for a skill importer.
 */

export const MAX_REDIRECTS = 3;
export const DEFAULT_TIMEOUT_MS = 10_000;

type Lookup = (hostname: string) => Promise<string[]>;

async function defaultLookup(hostname: string): Promise<string[]> {
  const answers = await dnsLookup(hostname, { all: true });
  return answers.map((a) => a.address);
}

export class FetchUrlFetcher implements UrlFetcher {
  private fetchImpl: typeof fetch;
  private lookup: Lookup;

  constructor(opts: { fetchImpl?: typeof fetch; lookup?: Lookup } = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.lookup = opts.lookup ?? defaultLookup;
  }

  async fetch(rawUrl: string, opts: UrlFetchOptions): Promise<FetchedResource> {
    const signal = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let current = assertPublicHttpUrl(rawUrl);

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await this.assertResolvesPublic(current);

      let res: Response;
      try {
        res = await this.fetchImpl(current.toString(), {
          redirect: 'manual',
          signal,
          headers: { accept: 'text/markdown, text/plain, application/zip;q=0.9, */*;q=0.5' },
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new ExternalServiceError(`Could not fetch ${current.hostname}: ${reason}`);
      }

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) {
          throw new ExternalServiceError(`Redirect from ${current.hostname} without a location`);
        }
        if (hop === MAX_REDIRECTS) {
          throw new ExternalServiceError(`Too many redirects (max ${MAX_REDIRECTS})`);
        }
        current = assertPublicHttpUrl(new URL(location, current).toString());
        continue;
      }

      if (!res.ok) {
        throw new ExternalServiceError(`${current.hostname} answered ${res.status}`);
      }

      const declared = Number(res.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > opts.maxBytes) {
        throw new ValidationError(`Resource too large (${declared} bytes, max ${opts.maxBytes})`);
      }

      const bytes = await readBounded(res, opts.maxBytes);
      return { url: current.toString(), contentType: res.headers.get('content-type'), bytes };
    }

    // Unreachable — the loop either returns or throws — but the compiler needs a tail.
    throw new ExternalServiceError('Fetch loop exited unexpectedly');
  }

  /** Every address the name resolves to must be public — not just the first. */
  private async assertResolvesPublic(url: URL): Promise<void> {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host)) return; // literal — already checked by the guard
    let addresses: string[];
    try {
      addresses = await this.lookup(host);
    } catch {
      throw new ExternalServiceError(`Could not resolve ${host}`);
    }
    if (addresses.length === 0) throw new ExternalServiceError(`Could not resolve ${host}`);
    if (addresses.some(isBlockedIp)) {
      throw new ValidationError(`Refusing to fetch ${host}: it resolves to a private address`);
    }
  }
}

/** Stream the body and give up as soon as it crosses `maxBytes`. */
async function readBounded(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new ValidationError(`Resource too large (over ${maxBytes} bytes)`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

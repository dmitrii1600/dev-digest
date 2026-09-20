import { describe, it, expect } from 'vitest';
import { assertPublicHttpUrl, isBlockedHostname, isBlockedIp } from '../src/adapters/url-fetcher/guard.js';
import { FetchUrlFetcher, MAX_REDIRECTS } from '../src/adapters/url-fetcher/fetch.js';
import { ExternalServiceError, ValidationError } from '../src/platform/errors.js';

/**
 * The URL importer's SSRF guard and the hand-rolled redirect/size loop, with
 * `fetch` and DNS stubbed — no network is ever touched here.
 */

describe('guard — assertPublicHttpUrl', () => {
  it.each([
    'https://example.com/a.md',
    'http://raw.githubusercontent.com/o/r/main/SKILL.md',
    'https://8.8.8.8/x.md',
  ])('allows %s', (url) => {
    expect(assertPublicHttpUrl(url).href).toBe(new URL(url).href);
  });

  it.each([
    'ftp://example.com/a.md',
    'file:///etc/passwd',
    'http://localhost/a.md',
    'http://foo.localhost/a.md',
    'http://printer.local/a.md',
    'http://svc.internal/a.md',
    'http://127.0.0.1:3001/health',
    'http://10.1.2.3/x',
    'http://172.16.0.9/x',
    'http://192.168.1.1/x',
    'http://169.254.169.254/latest/meta-data',
    'http://0.0.0.0/x',
    'http://[::1]/x',
    'http://[::ffff:10.0.0.1]/x',
    'http://[::ffff:a00:1]/x',
    'http://[fe80::1]/x',
    'http://[fd00::1]/x',
    'http://user:pw@example.com/x',
    'not a url',
  ])('rejects %s with a 422', (url) => {
    expect(() => assertPublicHttpUrl(url)).toThrow(ValidationError);
  });

  it('isBlockedIp / isBlockedHostname edge cases', () => {
    expect(isBlockedIp('1.1.1.1')).toBe(false);
    expect(isBlockedIp('100.64.0.1')).toBe(true); // CGNAT
    expect(isBlockedIp('224.0.0.1')).toBe(true); // multicast
    expect(isBlockedIp('2606:4700::1111')).toBe(false);
    expect(isBlockedIp('garbage')).toBe(true); // fail closed
    expect(isBlockedHostname('example.com.')).toBe(false);
    expect(isBlockedHostname('')).toBe(true);
  });
});

// ---------------------------------------------------------------- fetcher

type Handler = (url: string) => Response | Promise<Response>;

function stubFetch(handler: Handler): typeof fetch {
  return (async (input: string | URL | Request) => handler(String(input))) as unknown as typeof fetch;
}

const publicLookup = async () => ['93.184.216.34'];
const md = (text: string, headers: Record<string, string> = {}) =>
  new Response(text, { status: 200, headers: { 'content-type': 'text/markdown', ...headers } });

describe('FetchUrlFetcher', () => {
  it('returns bytes, content-type and the final url on 200', async () => {
    const f = new FetchUrlFetcher({ fetchImpl: stubFetch(() => md('# Hi')), lookup: publicLookup });
    const res = await f.fetch('https://example.com/SKILL.md', { maxBytes: 1024 });
    expect(new TextDecoder().decode(res.bytes)).toBe('# Hi');
    expect(res.contentType).toBe('text/markdown');
    expect(res.url).toBe('https://example.com/SKILL.md');
  });

  it('follows a redirect and reports the final url', async () => {
    const f = new FetchUrlFetcher({
      fetchImpl: stubFetch((url) =>
        url.endsWith('/old')
          ? new Response(null, { status: 302, headers: { location: '/new.md' } })
          : md('# Moved'),
      ),
      lookup: publicLookup,
    });
    const res = await f.fetch('https://example.com/old', { maxBytes: 1024 });
    expect(res.url).toBe('https://example.com/new.md');
  });

  it('a redirect hop into a private address is refused (422)', async () => {
    const f = new FetchUrlFetcher({
      fetchImpl: stubFetch(
        () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } }),
      ),
      lookup: publicLookup,
    });
    await expect(f.fetch('https://example.com/a.md', { maxBytes: 1024 })).rejects.toThrow(ValidationError);
  });

  it('a hostname that resolves to a private address is refused (422)', async () => {
    const f = new FetchUrlFetcher({
      fetchImpl: stubFetch(() => md('x')),
      lookup: async () => ['93.184.216.34', '10.0.0.5'],
    });
    await expect(f.fetch('https://evil.example/a.md', { maxBytes: 1024 })).rejects.toThrow(ValidationError);
  });

  it(`gives up after ${MAX_REDIRECTS} redirects (502)`, async () => {
    let n = 0;
    const f = new FetchUrlFetcher({
      fetchImpl: stubFetch(() => {
        n += 1;
        return new Response(null, { status: 301, headers: { location: `/hop${n}` } });
      }),
      lookup: publicLookup,
    });
    await expect(f.fetch('https://example.com/a', { maxBytes: 1024 })).rejects.toThrow(ExternalServiceError);
  });

  it('a declared content-length over the cap is refused before reading (422)', async () => {
    const f = new FetchUrlFetcher({
      fetchImpl: stubFetch(() => md('x', { 'content-length': '5000' })),
      lookup: publicLookup,
    });
    await expect(f.fetch('https://example.com/a.md', { maxBytes: 1024 })).rejects.toThrow(ValidationError);
  });

  it('a streamed body over the cap is aborted (422)', async () => {
    const f = new FetchUrlFetcher({
      fetchImpl: stubFetch(() => md('y'.repeat(2048))),
      lookup: publicLookup,
    });
    await expect(f.fetch('https://example.com/a.md', { maxBytes: 1024 })).rejects.toThrow(ValidationError);
  });

  it('a non-2xx answer is an external-service error (502)', async () => {
    const f = new FetchUrlFetcher({
      fetchImpl: stubFetch(() => new Response('nope', { status: 404 })),
      lookup: publicLookup,
    });
    await expect(f.fetch('https://example.com/a.md', { maxBytes: 1024 })).rejects.toThrow(ExternalServiceError);
  });

  it('a network failure is an external-service error (502)', async () => {
    const f = new FetchUrlFetcher({
      fetchImpl: stubFetch(() => {
        throw new Error('ECONNRESET');
      }),
      lookup: publicLookup,
    });
    await expect(f.fetch('https://example.com/a.md', { maxBytes: 1024 })).rejects.toThrow(ExternalServiceError);
  });
});

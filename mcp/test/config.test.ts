import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('defaults when no env vars are set', () => {
    const config = loadConfig({});
    expect(config).toEqual({
      apiUrl: 'http://localhost:3001',
      waitMs: 600_000,
      pollMs: 2_000,
      httpTimeoutMs: 30_000,
    });
  });

  it('applies overrides and strips a trailing slash from the API URL', () => {
    const config = loadConfig({
      DEVDIGEST_API_URL: 'http://127.0.0.1:4001/',
      DEVDIGEST_MCP_WAIT_MS: '120000',
      DEVDIGEST_MCP_POLL_MS: '1000',
    });
    expect(config.apiUrl).toBe('http://127.0.0.1:4001');
    expect(config.waitMs).toBe(120_000);
    expect(config.pollMs).toBe(1_000);
  });

  it('strips multiple trailing slashes', () => {
    const config = loadConfig({ DEVDIGEST_API_URL: 'http://localhost:3001///' });
    expect(config.apiUrl).toBe('http://localhost:3001');
  });

  it('rejects an invalid URL and names only the offending var', () => {
    expect(() => loadConfig({ DEVDIGEST_API_URL: 'not-a-url' })).toThrowError(
      'Invalid DEVDIGEST_* environment: DEVDIGEST_API_URL',
    );
  });

  it('rejects a wait value below the minimum', () => {
    expect(() => loadConfig({ DEVDIGEST_MCP_WAIT_MS: '1000' })).toThrowError(
      'Invalid DEVDIGEST_* environment: DEVDIGEST_MCP_WAIT_MS',
    );
  });

  it('rejects a wait value above the maximum', () => {
    expect(() => loadConfig({ DEVDIGEST_MCP_WAIT_MS: String(3_600_001) })).toThrowError(
      'Invalid DEVDIGEST_* environment: DEVDIGEST_MCP_WAIT_MS',
    );
  });

  it('rejects a poll value below the minimum', () => {
    expect(() => loadConfig({ DEVDIGEST_MCP_POLL_MS: '10' })).toThrowError(
      'Invalid DEVDIGEST_* environment: DEVDIGEST_MCP_POLL_MS',
    );
  });

  it('never leaks the invalid value into the error message', () => {
    try {
      loadConfig({ DEVDIGEST_API_URL: 'http://user:supersecret@bad host' });
      expect.unreachable('loadConfig should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain('supersecret');
      expect(message).not.toContain('bad host');
      expect(message).toBe('Invalid DEVDIGEST_* environment: DEVDIGEST_API_URL');
    }
  });

  it('reports every offending var name, deduplicated, when several are invalid', () => {
    try {
      loadConfig({ DEVDIGEST_API_URL: 'nope', DEVDIGEST_MCP_WAIT_MS: '1' });
      expect.unreachable('loadConfig should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('DEVDIGEST_API_URL');
      expect(message).toContain('DEVDIGEST_MCP_WAIT_MS');
    }
  });
});

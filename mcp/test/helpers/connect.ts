import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Config } from '../../src/config.js';
import { createServer, type Clock, type CreateServerDeps } from '../../src/server.js';

/**
 * A fake clock whose `sleep` advances `now()` instantly instead of waiting in
 * real time — `wait.ts`'s backoff loop runs at test speed, deterministically.
 */
export interface FakeClock extends Clock {
  advance(ms: number): void;
}

export function createFakeClock(startAt = 0): FakeClock {
  let time = startAt;
  return {
    now: () => time,
    advance(ms: number) {
      time += ms;
    },
    async sleep(ms: number, signal?: AbortSignal) {
      time += ms;
      // Resolve on the next microtask regardless — the clock owns "time", not
      // real timers, so there is nothing to actually wait for. If the signal
      // is already aborted, resolve immediately too (waitForRuns checks
      // `signal.aborted` itself on the next loop iteration).
      void signal;
      await Promise.resolve();
    },
  };
}

export function defaultTestConfig(overrides: Partial<Config> = {}): Config {
  return {
    apiUrl: 'http://localhost:3001',
    waitMs: 600_000,
    pollMs: 2_000,
    httpTimeoutMs: 30_000,
    ...overrides,
  };
}

export interface Connected {
  server: ReturnType<typeof createServer>;
  client: Client;
  clock: FakeClock;
}

/** Wires a fresh `createServer(...)` to a fresh `Client` over a linked pair
 *  of `InMemoryTransport`s — no stdio, no process, no Docker. */
export async function connect(
  deps: { api: ApiClient; config?: Config; clock?: FakeClock } & Partial<CreateServerDeps>,
): Promise<Connected> {
  const clock = deps.clock ?? createFakeClock();
  const config = deps.config ?? defaultTestConfig();
  const server = createServer({ api: deps.api, config, clock });

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return { server, client, clock };
}

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

// Hoisted so the vi.mock factories can reach them.
const h = vi.hoisted(() => ({
  openaiCreate: vi.fn(),
  openaiCtor: vi.fn(),
  anthropicCreate: vi.fn(),
  anthropicCtor: vi.fn(),
  openRouterCtor: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: h.openaiCreate } };
    constructor(opts: unknown) {
      h.openaiCtor(opts);
    }
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: h.anthropicCreate };
    constructor(opts: unknown) {
      h.anthropicCtor(opts);
    }
  },
}));

vi.mock('@devdigest/reviewer-core', async (orig) => {
  const actual = await orig<typeof import('@devdigest/reviewer-core')>();
  return {
    ...actual,
    OpenRouterProvider: class {
      readonly id = 'openrouter' as const;
      constructor(key: string, opts: unknown) {
        h.openRouterCtor(key, opts);
      }
    },
  };
});

import { OpenAIProvider } from '../src/adapters/llm/openai.js';
import { AnthropicProvider } from '../src/adapters/llm/anthropic.js';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { MockLLMProvider, MockSecretsProvider } from '../src/adapters/mocks.js';

const Schema = z.object({ ok: z.boolean() });
const REQ = {
  model: 'm',
  schema: Schema,
  schemaName: 'Thing',
  messages: [{ role: 'user' as const, content: 'hi' }],
  maxRetries: 0,
};

/** Run `fn` under fake timers, flush every pending back-off, and settle its outcome. */
async function settle(fn: () => Promise<unknown>): Promise<unknown> {
  const p = fn().then(
    () => undefined,
    (e: unknown) => e,
  );
  await vi.runAllTimersAsync();
  return p;
}

beforeEach(() => {
  vi.useFakeTimers();
  h.openaiCreate.mockReset();
  h.openaiCtor.mockReset();
  h.anthropicCreate.mockReset();
  h.anthropicCtor.mockReset();
  h.openRouterCtor.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('single-shot OpenAIProvider', () => {
  it('makes exactly one attempt on a 500 and builds the SDK with maxRetries: 0', async () => {
    h.openaiCreate.mockRejectedValue({ status: 500 });
    const provider = new OpenAIProvider('k', { singleShot: true });
    const err = await settle(() => provider.completeStructured(REQ));
    expect(err).toMatchObject({ status: 500 });
    expect(h.openaiCreate).toHaveBeenCalledTimes(1);
    expect(h.openaiCtor).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }));
  });

  it('a default instance still retries and leaves the SDK default', async () => {
    h.openaiCreate.mockRejectedValue({ status: 500 });
    const provider = new OpenAIProvider('k');
    await settle(() => provider.completeStructured(REQ));
    expect(h.openaiCreate.mock.calls.length).toBeGreaterThan(1);
    expect(h.openaiCtor.mock.calls[0]![0]).not.toHaveProperty('maxRetries');
  });
});

describe('single-shot AnthropicProvider', () => {
  it('makes exactly one attempt on a 500 and builds the SDK with maxRetries: 0', async () => {
    h.anthropicCreate.mockRejectedValue({ status: 500 });
    const provider = new AnthropicProvider('k', { singleShot: true });
    const err = await settle(() => provider.completeStructured(REQ));
    expect(err).toMatchObject({ status: 500 });
    expect(h.anthropicCreate).toHaveBeenCalledTimes(1);
    expect(h.anthropicCtor).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }));
  });

  it('a default instance still retries and leaves the SDK default', async () => {
    h.anthropicCreate.mockRejectedValue({ status: 500 });
    const provider = new AnthropicProvider('k');
    await settle(() => provider.completeStructured(REQ));
    expect(h.anthropicCreate.mock.calls.length).toBeGreaterThan(1);
    expect(h.anthropicCtor.mock.calls[0]![0]).not.toHaveProperty('maxRetries');
  });
});

describe('Container.llm single-shot', () => {
  function container(overrides: ConstructorParameters<typeof Container>[2] = {}) {
    return new Container(loadConfig({} as NodeJS.ProcessEnv), {} as ConstructorParameters<typeof Container>[1], {
      secrets: new MockSecretsProvider({
        OPENAI_API_KEY: 'ok',
        ANTHROPIC_API_KEY: 'ak',
        OPENROUTER_API_KEY: 'rk',
      }),
      ...overrides,
    });
  }

  it('builds OpenRouter with { maxRetries: 0, timeoutMs } and caches it apart from the default', async () => {
    const c = container();
    const single = await c.llm('openrouter', { singleShot: { timeoutMs: 125_000 } });
    expect(h.openRouterCtor).toHaveBeenCalledTimes(1);
    expect(h.openRouterCtor.mock.calls[0]![1]).toMatchObject({ maxRetries: 0, timeoutMs: 125000 });
    // same key → cached
    expect(await c.llm('openrouter', { singleShot: { timeoutMs: 125_000 } })).toBe(single);
    expect(h.openRouterCtor).toHaveBeenCalledTimes(1);
    // the default variant is a separate instance, built without those options
    const plain = await c.llm('openrouter');
    expect(plain).not.toBe(single);
    expect(h.openRouterCtor.mock.calls[1]![1]).not.toHaveProperty('maxRetries');
  });

  it('builds single-shot OpenAI and Anthropic instances with maxRetries: 0', async () => {
    const c = container();
    await c.llm('openai', { singleShot: { timeoutMs: 125_000 } });
    await c.llm('anthropic', { singleShot: { timeoutMs: 125_000 } });
    expect(h.openaiCtor).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }));
    expect(h.anthropicCtor).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }));
  });

  it('invalidateSecretCaches drops the single-shot instance too', async () => {
    const c = container();
    const a = await c.llm('openai', { singleShot: { timeoutMs: 1 } });
    c.invalidateSecretCaches();
    expect(await c.llm('openai', { singleShot: { timeoutMs: 1 } })).not.toBe(a);
  });

  it('an injected override wins for both call shapes', async () => {
    const mock = new MockLLMProvider();
    const c = container({ llm: { openai: mock } });
    expect(await c.llm('openai')).toBe(mock);
    expect(await c.llm('openai', { singleShot: { timeoutMs: 125_000 } })).toBe(mock);
  });
});

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { LLMProvider, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { SchemaFailureTagger } from '../src/adapters/llm/schema-failure.js';
import { StructuredOutputError } from '../src/platform/errors.js';

/**
 * The OpenRouter provider (reviewer-core, ring 0) throws a bare Error when the
 * answer never matches the schema. The tagger turns that into the typed
 * `StructuredOutputError` by observing `safeParse`, not by reading messages.
 */

const Schema = z.object({ a: z.string() });

function inner(answer: unknown, thenThrow: Error): LLMProvider {
  return {
    id: 'openrouter',
    listModels: async () => [],
    complete: async () => {
      throw new Error('unused');
    },
    embed: async () => [],
    completeStructured: async <T,>(req: StructuredRequest<T>): Promise<StructuredResult<T>> => {
      const parsed = req.schema.safeParse(answer);
      if (parsed.success) {
        return { data: parsed.data, model: req.model, tokensIn: 1, tokensOut: 1, costUsd: null, raw: '', attempts: 1 };
      }
      throw thenThrow;
    },
  };
}

const req = { model: 'm', schema: Schema, schemaName: 'Schema', messages: [] };

describe('SchemaFailureTagger', () => {
  it('a throw after a failed safeParse becomes StructuredOutputError, whatever the message says', async () => {
    const tagger = new SchemaFailureTagger(inner({ a: 1 }, new Error('boom')));
    await expect(tagger.completeStructured(req)).rejects.toBeInstanceOf(StructuredOutputError);
  });

  it('a throw with no schema failure behind it is passed through untouched', async () => {
    const original = new Error('failed schema validation (but never parsed)');
    const failing: LLMProvider = {
      ...inner({ a: 'x' }, original),
      completeStructured: async () => {
        throw original;
      },
    };
    await expect(new SchemaFailureTagger(failing).completeStructured(req)).rejects.toBe(original);
  });

  it('a valid answer passes through and the id is the inner provider id', async () => {
    const tagger = new SchemaFailureTagger(inner({ a: 'x' }, new Error('unused')));
    expect(tagger.id).toBe('openrouter');
    expect((await tagger.completeStructured(req)).data).toEqual({ a: 'x' });
  });
});

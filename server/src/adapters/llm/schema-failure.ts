import type {
  CompletionRequest,
  CompletionResult,
  LLMProvider,
  ModelInfo,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { StructuredOutputError } from '../../platform/errors.js';

/**
 * Decorates a provider whose structured-output failure is a bare `Error` (the
 * OpenRouter one in reviewer-core, ring 0 — it cannot import server errors)
 * so it surfaces as the typed `StructuredOutputError` like the other adapters.
 *
 * The signal is not message text: the request schema is shadowed by a copy
 * whose `safeParse` records its last outcome. A throw that follows a failed
 * `safeParse` means "the model answered, the answer did not match".
 * Caveat: output that is not even JSON never reaches `safeParse`, so it stays
 * a plain provider error.
 */
export class SchemaFailureTagger implements LLMProvider {
  constructor(private readonly inner: LLMProvider) {}

  get id(): LLMProvider['id'] {
    return this.inner.id;
  }

  listModels(): Promise<ModelInfo[]> {
    return this.inner.listModels();
  }

  complete(req: CompletionRequest): Promise<CompletionResult> {
    return this.inner.complete(req);
  }

  embed(texts: string[]): Promise<number[][]> {
    return this.inner.embed(texts);
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    let lastParseFailed = false;
    // Zod v3 binds `safeParse` as an own property in the constructor, so an own
    // override on a derived object wins; everything else is inherited.
    const tracked = Object.create(req.schema) as StructuredRequest<T>['schema'];
    tracked.safeParse = (data, params) => {
      const result = req.schema.safeParse(data, params);
      lastParseFailed = !result.success;
      return result;
    };
    try {
      return await this.inner.completeStructured({ ...req, schema: tracked });
    } catch (err) {
      if (lastParseFailed && !(err instanceof StructuredOutputError)) {
        throw new StructuredOutputError(
          `${this.inner.id} structured output failed schema validation for ${req.schemaName}`,
          { cause: err instanceof Error ? err.message : String(err) },
        );
      }
      throw err;
    }
  }
}

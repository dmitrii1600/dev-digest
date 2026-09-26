// Tool INPUT schemas use zod/v4 (bundled inside the zod 3.25 pin), not the
// project's usual v3 import — see the "Zod fallback" note in
// specs/06-mcp-server.md step 6: SDK 1.30.x's `registerTool` overload
// resolution hit `tsc`'s type-instantiation depth limit (TS2589) against a
// plain v3 `ZodRawShape` here. `@devdigest/shared` (parsed via `safeParse` in
// api-client.ts) is unaffected and stays on v3 — this only touches how a
// tool's own input shape is authored.
import { z } from 'zod/v4';

/**
 * Shared, flat-primitive parameter fragments reused across tool input
 * schemas. Every `.describe()` string here is canonical product text —
 * change it only through `specs/06-mcp-server.md` → *Final tool descriptions*,
 * and re-run `test/tools-list-budget.test.ts` after.
 */

export const repo = z.string().min(1).describe('Repository "owner/name" (or its id).');

export const pr = z
  .union([z.number().int().positive(), z.string().min(1)])
  .describe('Pull request number (or its id).');

export const responseFormat = z
  .enum(['concise', 'detailed'])
  .default('concise')
  .describe('"detailed" adds rationale, confidence and summary.');

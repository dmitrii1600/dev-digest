import { log } from './log.js';

/**
 * Clips a string to `n` chars, appending an ellipsis when it was longer.
 * Shared low-level helper: `api-client.ts` clips server error text before it
 * ever enters an `ApiError`, `resolve.ts` clips echoed user input, and
 * `format.ts` re-exports this for the response-shaping caps.
 */
export function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/**
 * A user-facing, actionable error. Its `message` is shown to the model
 * verbatim — never wrapped, never prefixed with "Error:" — so every
 * `ToolError` message is written as a complete sentence a caller can act on.
 */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export type ApiErrorKind =
  | 'unreachable'
  | 'not_found'
  | 'rate_limited'
  | 'bad_request'
  | 'server'
  | 'contract';

/**
 * Raised by `api-client.ts` for every failure talking to the DevDigest API.
 * Carries just enough to build a safe, actionable message: `origin` (never
 * the full URL, so embedded credentials never surface) plus `method`/`path`
 * for the endpoint, and an optional HTTP `status` / clipped `serverMessage`.
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | undefined;
  readonly method: string;
  readonly path: string;
  readonly origin: string;
  readonly serverMessage: string | undefined;

  constructor(opts: {
    kind: ApiErrorKind;
    method: string;
    path: string;
    origin: string;
    status?: number;
    serverMessage?: string;
  }) {
    super(`ApiError(${opts.kind}): ${opts.method} ${opts.path}`);
    this.name = 'ApiError';
    this.kind = opts.kind;
    this.method = opts.method;
    this.path = opts.path;
    this.origin = opts.origin;
    this.status = opts.status;
    this.serverMessage = opts.serverMessage;
  }

  /** "<METHOD> <path>", the identifier every non-`unreachable` message shows. */
  get endpoint(): string {
    return `${this.method} ${this.path}`;
  }
}

/**
 * MCP tool result shape for a failed call: text content + `isError: true`.
 * The index signature is required to structurally satisfy the SDK's
 * `CallToolResult` (itself an indexed type) without importing it here.
 */
export interface ToolErrorResult {
  [key: string]: unknown;
  content: [{ type: 'text'; text: string }];
  isError: true;
}

function textResult(text: string): ToolErrorResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * Turns any thrown value into a safe, actionable `ToolError` result. This is
 * the ONLY place an error becomes model-visible text — the SDK's own default
 * (`error.message` verbatim, which could include a stack, a zod issue dump, or
 * a raw API response body) never reaches the caller.
 */
export function toErrorResult(err: unknown): ToolErrorResult {
  if (err instanceof ToolError) {
    return textResult(err.message);
  }
  if (err instanceof ApiError) {
    switch (err.kind) {
      case 'unreachable':
        return textResult(
          `DevDigest API is not reachable at ${err.origin}. Start it with ./scripts/dev.sh (or cd server && pnpm dev), then retry.`,
        );
      case 'rate_limited':
        return textResult(
          `DevDigest API rate limit hit on ${err.endpoint} (reviews: 10/min). Wait a minute, then retry.`,
        );
      case 'server':
        return textResult(
          `DevDigest API error ${err.status ?? 500} on ${err.endpoint}. Check the API terminal log.`,
        );
      case 'contract':
        return textResult(
          `DevDigest API returned an unexpected shape for ${err.endpoint} (API and MCP versions differ?).`,
        );
      case 'not_found':
        return textResult(`DevDigest API found nothing at ${err.endpoint} (404).`);
      case 'bad_request':
        return textResult(
          `DevDigest API rejected ${err.endpoint}${err.serverMessage ? `: ${err.serverMessage}` : ''}.`,
        );
      default: {
        const _exhaustive: never = err.kind;
        return textResult(`Internal error in the devdigest MCP server (see its stderr log).`);
      }
    }
  }
  // Anything else is unexpected: log the stack to stderr only (never to the
  // model, which would leak internals) and return a generic message.
  const stack = err instanceof Error ? err.stack : String(err);
  log('error', 'internal error', { stack });
  return textResult('Internal error in the devdigest MCP server (see its stderr log).');
}

/**
 * Runs a tool handler body and turns ANY thrown value — a `ToolError`, an
 * `ApiError`, or a genuine bug — into `toErrorResult(...)` instead of letting
 * it reach the SDK's own default error handling, which would surface the raw
 * `error.message` (a stack trace, a zod issue dump, …) straight to the model.
 *
 * Shaped as "wrap a thunk", not "wrap a handler", so each tool's callback
 * passed to `registerTool` stays a plain, concretely-typed function (its
 * `args`/`extra` types come straight from the SDK's own inference over the
 * tool's `inputSchema`) — layering another generic function in between there
 * made `tsc` blow past its type-instantiation depth limit.
 */
export async function safe<T>(fn: () => Promise<T>): Promise<T | ToolErrorResult> {
  try {
    return await fn();
  } catch (err) {
    return toErrorResult(err);
  }
}

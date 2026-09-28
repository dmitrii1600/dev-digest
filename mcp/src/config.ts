import { z } from 'zod';

/**
 * Runtime configuration for the devdigest MCP server, parsed once at startup
 * from `process.env` (or an injected object in tests). Every knob is a plain
 * env var — no secrets live here; `.mcp.json` only ever sets
 * `DEVDIGEST_API_URL`.
 */
export interface Config {
  /** Origin of the DevDigest API, trailing slash stripped. */
  apiUrl: string;
  /** How long `run_agent_on_pr` waits for a terminal run before returning `running`. */
  waitMs: number;
  /** Starting poll interval for `run_agent_on_pr`'s wait loop (grows with backoff). */
  pollMs: number;
  /** Per-request fetch timeout. `GET /repos/:id/pulls` may sync from GitHub, so this
   *  is generous rather than tuned to the fastest endpoint. */
  httpTimeoutMs: number;
}

/** Not env-configurable: every API call gets the same budget. */
const HTTP_TIMEOUT_MS = 30_000;

const EnvSchema = z.object({
  DEVDIGEST_API_URL: z.string().url().default('http://localhost:3001'),
  DEVDIGEST_MCP_WAIT_MS: z.coerce.number().int().min(5_000).max(3_600_000).default(600_000),
  DEVDIGEST_MCP_POLL_MS: z.coerce.number().int().min(500).default(2_000),
});

/**
 * Parses `DEVDIGEST_*` env vars into a {@link Config}. Throws with only the
 * offending variable **names** on invalid input — never the values, which
 * could otherwise leak a malformed URL (credentials) into a log or an error
 * surfaced to the model.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = EnvSchema.safeParse({
    DEVDIGEST_API_URL: env.DEVDIGEST_API_URL,
    DEVDIGEST_MCP_WAIT_MS: env.DEVDIGEST_MCP_WAIT_MS,
    DEVDIGEST_MCP_POLL_MS: env.DEVDIGEST_MCP_POLL_MS,
  });
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
    throw new Error(`Invalid DEVDIGEST_* environment: ${names.join(', ')}`);
  }
  return {
    apiUrl: result.data.DEVDIGEST_API_URL.replace(/\/+$/, ''),
    waitMs: result.data.DEVDIGEST_MCP_WAIT_MS,
    pollMs: result.data.DEVDIGEST_MCP_POLL_MS,
    httpTimeoutMs: HTTP_TIMEOUT_MS,
  };
}

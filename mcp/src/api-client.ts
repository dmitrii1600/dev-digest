import {
  Agent,
  ApiErrorBody,
  ConventionsPage,
  PrMeta,
  Repo,
  ReviewRecord,
  ReviewRunResponse,
  RunRequest,
  RunSummary,
} from '@devdigest/shared';
import { ApiError, clip } from './errors.js';

export interface ApiClient {
  listRepos(opts?: RequestOpts): Promise<Repo[]>;
  listPulls(repoId: string, opts?: RequestOpts): Promise<PrMeta[]>;
  listAgents(opts?: RequestOpts): Promise<Agent[]>;
  startReview(prId: string, body: RunRequest, opts?: RequestOpts): Promise<ReviewRunResponse>;
  listRuns(prId: string, opts?: RequestOpts): Promise<RunSummary[]>;
  listReviews(prId: string, opts?: RequestOpts): Promise<ReviewRecord[]>;
  getConventions(repoId: string, opts?: RequestOpts): Promise<ConventionsPage>;
}

export interface RequestOpts {
  signal?: AbortSignal;
}

export type FetchImpl = typeof fetch;

export interface CreateApiClientOpts {
  baseUrl: string;
  fetchImpl?: FetchImpl;
  timeoutMs: number;
}

/** `new URL(base).origin` only — strips any credentials/path before it can
 *  ever surface in a message. Falls back to the raw string if `base` somehow
 *  is not a valid URL (loadConfig already validates it, so this is a guard,
 *  not the primary path). */
function safeOrigin(base: string): string {
  try {
    return new URL(base).origin;
  } catch {
    return base;
  }
}

/** True for the two ways a fetch can fail to complete at all: a network
 *  error (`TypeError`, e.g. ECONNREFUSED) or our own request timeout /
 *  an aborted signal — none of which produced an HTTP response. */
function isUnreachable(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const name = (err as { name?: string } | undefined)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

/**
 * Thin HTTP adapter over the DevDigest API. Every method validates its
 * response with the matching `@devdigest/shared` schema via `safeParse` and
 * throws `ApiError('contract')` on a mismatch — the response shape is never
 * redefined here. Path identifiers are percent-encoded; POST bodies are
 * always an explicit JSON payload with `content-type: application/json`
 * (an "optional body" is not a thing this API accepts, see server/INSIGHTS.md).
 */
export function createApiClient(opts: CreateApiClientOpts): ApiClient {
  const baseUrl = opts.baseUrl;
  const fetchImpl: FetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs;
  const origin = safeOrigin(baseUrl);

  async function request(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    reqOpts: RequestOpts | undefined,
  ): Promise<unknown> {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = reqOpts?.signal ? AbortSignal.any([reqOpts.signal, timeoutSignal]) : timeoutSignal;

    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        ...(body !== undefined
          ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
        signal,
      });
    } catch (err) {
      if (isUnreachable(err)) {
        throw new ApiError({ kind: 'unreachable', method, path, origin });
      }
      throw err;
    }

    if (res.status === 404) {
      throw new ApiError({ kind: 'not_found', method, path, origin, status: res.status });
    }
    if (res.status === 429) {
      throw new ApiError({ kind: 'rate_limited', method, path, origin, status: res.status });
    }
    if (res.status === 400 || res.status === 422) {
      const json = await safeReadJson(res);
      const parsed = ApiErrorBody.safeParse(json);
      throw new ApiError({
        kind: 'bad_request',
        method,
        path,
        origin,
        status: res.status,
        ...(parsed.success ? { serverMessage: clip(parsed.data.error.message, 200) } : {}),
      });
    }
    if (!res.ok) {
      // Any other non-2xx (incl. every 5xx) — the response body is NEVER
      // included in the thrown error; it may be an HTML error page or leak
      // internals.
      throw new ApiError({ kind: 'server', method, path, origin, status: res.status });
    }
    return res.json();
  }

  async function safeReadJson(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      return undefined;
    }
  }

  function parseOrThrow<T>(schema: { safeParse(v: unknown): { success: boolean; data?: T } }, json: unknown, method: string, path: string): T {
    const result = schema.safeParse(json);
    if (!result.success) {
      throw new ApiError({ kind: 'contract', method, path, origin });
    }
    return result.data as T;
  }

  return {
    async listRepos(reqOpts) {
      const json = await request('GET', '/repos', undefined, reqOpts);
      return parseOrThrow(Repo.array(), json, 'GET', '/repos');
    },
    async listPulls(repoId, reqOpts) {
      const path = `/repos/${encodeURIComponent(repoId)}/pulls`;
      const json = await request('GET', path, undefined, reqOpts);
      return parseOrThrow(PrMeta.array(), json, 'GET', path);
    },
    async listAgents(reqOpts) {
      const json = await request('GET', '/agents', undefined, reqOpts);
      return parseOrThrow(Agent.array(), json, 'GET', '/agents');
    },
    async startReview(prId, body, reqOpts) {
      const path = `/pulls/${encodeURIComponent(prId)}/review`;
      const json = await request('POST', path, body, reqOpts);
      return parseOrThrow(ReviewRunResponse, json, 'POST', path);
    },
    async listRuns(prId, reqOpts) {
      const path = `/pulls/${encodeURIComponent(prId)}/runs`;
      const json = await request('GET', path, undefined, reqOpts);
      return parseOrThrow(RunSummary.array(), json, 'GET', path);
    },
    async listReviews(prId, reqOpts) {
      const path = `/pulls/${encodeURIComponent(prId)}/reviews`;
      const json = await request('GET', path, undefined, reqOpts);
      return parseOrThrow(ReviewRecord.array(), json, 'GET', path);
    },
    async getConventions(repoId, reqOpts) {
      const path = `/repos/${encodeURIComponent(repoId)}/conventions`;
      const json = await request('GET', path, undefined, reqOpts);
      return parseOrThrow(ConventionsPage, json, 'GET', path);
    },
  };
}

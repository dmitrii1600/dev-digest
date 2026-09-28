import type { Agent, PrMeta, Repo } from '@devdigest/shared';
import type { ApiClient } from './api-client.js';
import { clip, ToolError } from './errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

/** Cap how many names an error message lists, so a large workspace never
 *  produces an unbounded error string. */
const MAX_LISTED = 10;

function listNames(names: string[]): string {
  const shown = names.slice(0, MAX_LISTED);
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(', ')}, +${rest} more` : shown.join(', ');
}

/** Echoed user input never grows a message past this — it is untrusted, if short-lived. */
const ECHO_CLIP = 100;

export interface ResolvedRepo {
  id: string;
  full_name: string;
}

export interface ResolvedPr {
  id: string;
  number: number;
  label: string;
}

export type ResolvedAgent = { kind: 'all' } | { kind: 'one'; id: string; name: string };

export interface Resolver {
  resolveRepo(input: string): Promise<ResolvedRepo>;
  resolvePr(repo: ResolvedRepo, input: number | string): Promise<ResolvedPr>;
  resolveAgent(input: string, opts: { enabledOnly: boolean }): Promise<ResolvedAgent>;
}

/**
 * Identifier resolution for the five tools: repo/PR/agent inputs are always
 * human-typed (`"owner/name"`, `482`, `"security"`, `"all"`) never DB ids, so
 * every tool resolves them against a fresh listing before doing anything
 * else. Created **once per tool call** — the memo below is local to that
 * call, never a cross-call cache, so a repo added mid-session is always seen
 * on the next call.
 */
export function createResolver(api: ApiClient): Resolver {
  let reposPromise: Promise<Repo[]> | undefined;
  let agentsPromise: Promise<Agent[]> | undefined;
  const pullsPromise = new Map<string, Promise<PrMeta[]>>();

  function listRepos(): Promise<Repo[]> {
    reposPromise ??= api.listRepos();
    return reposPromise;
  }
  function listAgents(): Promise<Agent[]> {
    agentsPromise ??= api.listAgents();
    return agentsPromise;
  }
  function listPulls(repoId: string): Promise<PrMeta[]> {
    let p = pullsPromise.get(repoId);
    if (!p) {
      p = api.listPulls(repoId);
      pullsPromise.set(repoId, p);
    }
    return p;
  }

  async function resolveRepo(rawInput: string): Promise<ResolvedRepo> {
    const input = rawInput.trim();
    const repos = await listRepos();
    if (repos.length === 0) {
      throw new ToolError('No repos imported yet — add one in the DevDigest studio.');
    }

    let matches: Repo[];
    if (isUuid(input)) {
      matches = repos.filter((r) => r.id === input);
    } else if (input.includes('/')) {
      matches = repos.filter((r) => r.full_name.toLowerCase() === input.toLowerCase());
    } else {
      matches = repos.filter((r) => r.name.toLowerCase() === input.toLowerCase());
    }

    if (matches.length === 0) {
      const names = listNames(repos.map((r) => r.full_name));
      throw new ToolError(
        `Repo '${clip(input, ECHO_CLIP)}' not found. Known repos: ${names}. Add a repo in the DevDigest studio first.`,
      );
    }
    if (matches.length > 1) {
      const names = matches.map((r) => r.full_name).join(', ');
      throw new ToolError(
        `Repo '${clip(input, ECHO_CLIP)}' is ambiguous: ${names}. Pass it as owner/name.`,
      );
    }
    const repo = matches[0]!;
    return { id: repo.id, full_name: repo.full_name };
  }

  async function resolvePr(repo: ResolvedRepo, rawInput: number | string): Promise<ResolvedPr> {
    const input = typeof rawInput === 'number' ? String(rawInput) : rawInput.trim();
    const pulls = await listPulls(repo.id);

    let match: PrMeta | undefined;
    if (isUuid(input)) {
      match = pulls.find((p) => p.id === input);
    } else {
      const numeric = input.startsWith('#') ? input.slice(1) : input;
      const n = Number(numeric);
      if (Number.isInteger(n)) {
        match = pulls.find((p) => p.number === n);
      }
    }

    if (!match) {
      const numbers = pulls.map((p) => `#${p.number}`);
      throw new ToolError(
        `PR ${formatPrEcho(input)} not found in ${repo.full_name}. Known PRs: ${listNames(numbers)}. Import PRs in the DevDigest studio.`,
      );
    }
    if (match.id == null) {
      throw new ToolError(
        `PR #${match.number} has no DevDigest id yet — open the repo in the studio to import it, then retry.`,
      );
    }
    return { id: match.id, number: match.number, label: `${repo.full_name}#${match.number}` };
  }

  async function resolveAgent(
    rawInput: string,
    opts: { enabledOnly: boolean },
  ): Promise<ResolvedAgent> {
    const input = rawInput.trim();
    // '' is a substring of every name — without this guard a whitespace-only
    // agent would silently resolve to the sole agent instead of "not found".
    if (!input) throw new ToolError('Agent name is empty — call list_agents for valid names.');
    if (input.toLowerCase() === 'all') return { kind: 'all' };

    const agents = await listAgents();

    if (isUuid(input)) {
      const byId = agents.find((a) => a.id === input);
      if (!byId) {
        throw new ToolError(`Agent '${clip(input, ECHO_CLIP)}' not found — call list_agents for valid names.`);
      }
      return finish(byId);
    }

    const exact = agents.find((a) => a.name.toLowerCase() === input.toLowerCase());
    if (exact) return finish(exact);

    const lower = input.toLowerCase();
    const substring = agents.filter((a) => a.name.toLowerCase().includes(lower));
    if (substring.length === 1) return finish(substring[0]!);
    if (substring.length > 1) {
      const names = substring.map((a) => a.name).join(', ');
      throw new ToolError(
        `Agent '${clip(input, ECHO_CLIP)}' matches several agents: ${names}. Use the full name from list_agents.`,
      );
    }

    throw new ToolError(`Agent '${clip(input, ECHO_CLIP)}' not found — call list_agents for valid names.`);

    function finish(agent: Agent): ResolvedAgent {
      if (opts.enabledOnly && !agent.enabled) {
        throw new ToolError(
          `Agent '${agent.name}' is disabled — enable it in the DevDigest studio or pick one from list_agents.`,
        );
      }
      return { kind: 'one', id: agent.id, name: agent.name };
    }
  }

  return { resolveRepo, resolvePr, resolveAgent };
}

function formatPrEcho(input: string): string {
  if (/^\d+$/.test(input)) return `#${input}`;
  if (/^#\d+$/.test(input)) return input;
  return `'${clip(input, ECHO_CLIP)}'`;
}

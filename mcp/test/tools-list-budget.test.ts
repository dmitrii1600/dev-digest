import { describe, expect, it } from 'vitest';
import { createApiClient } from '../src/api-client.js';
import { connect } from './helpers/connect.js';
import { createFakeApi } from './helpers/fake-api.js';
import { createFixtureState } from './helpers/fixtures.js';

/**
 * Token-cost budget for the whole server: `instructions` plus every tool's
 * `description` and input schema are injected into the system prompt (in
 * full, or under Claude Code's deferred loading, on first tool use) — every
 * byte here is a byte the model always pays for.
 *
 * `MAX_INSTRUCTIONS_CHARS` is the fixed product rule from the canonical
 * "Server instructions" text (specs/08-mcp-server.md — "one sentence,
 * ≤200 chars"), not a measured-and-tightened number.
 *
 * The other two were measured on the first green run of this suite
 * (descriptionsTotal 1058, tools/list JSON 4236 — see mcp/INSIGHTS.md for
 * the full numbers, including why 4236 ran ~6% over the plan's ~4,000
 * pre-measurement estimate: zod-to-JSON-schema adds `type`/`additionalProperties`
 * boilerplate per field beyond the raw description text) and are set here to
 * measured + ~15% headroom. A later regression means trim the text; raise
 * the budget only with a justification.
 *
 * `specs/09-blast-radius.md` replaced the `get_blast_radius` stub description
 * and added blast radius to `SERVER_INSTRUCTIONS`, which re-measured as
 * instructions 167 (was 156), descriptionsTotal 1127 (was 1058), tools/list
 * JSON 4303 (was 4236). All three stay comfortably under the existing
 * headroom, so the constants are unchanged.
 */
const MAX_INSTRUCTIONS_CHARS = 200;
const MAX_DESCRIPTIONS_TOTAL_CHARS = 1_217; // measured 1058 × 1.15
const MAX_TOOLS_LIST_JSON_CHARS = 4_872; // measured 4236 × 1.15

const EXPECTED_NAMES = [
  'get_blast_radius',
  'get_conventions',
  'get_findings',
  'list_agents',
  'run_agent_on_pr',
];

const EXPECTED_ANNOTATIONS: Record<string, Record<string, unknown>> = {
  list_agents: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  get_blast_radius: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  get_findings: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  get_conventions: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  run_agent_on_pr: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
};

describe('tools/list budget', () => {
  it('exposes exactly the five expected tool names, none prefixed with devdigest', async () => {
    const fake = createFakeApi(createFixtureState());
    const api = createApiClient({ baseUrl: 'http://localhost:3001', fetchImpl: fake.fetchImpl, timeoutMs: 5_000 });
    const { client } = await connect({ api });

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED_NAMES].sort());
    for (const t of tools) expect(t.name).not.toContain('devdigest');
  });

  it('carries the expected annotations and no tool has an outputSchema', async () => {
    const fake = createFakeApi(createFixtureState());
    const api = createApiClient({ baseUrl: 'http://localhost:3001', fetchImpl: fake.fetchImpl, timeoutMs: 5_000 });
    const { client } = await connect({ api });

    const { tools } = await client.listTools();
    for (const t of tools) {
      expect(t.annotations).toEqual(EXPECTED_ANNOTATIONS[t.name]);
      expect(t.outputSchema).toBeUndefined();
      expect(t.title).toBeUndefined();
    }
  });

  it('stays within the char budgets for instructions, descriptions, and the whole payload', async () => {
    const fake = createFakeApi(createFixtureState());
    const api = createApiClient({ baseUrl: 'http://localhost:3001', fetchImpl: fake.fetchImpl, timeoutMs: 5_000 });
    const { client } = await connect({ api });

    const { tools } = await client.listTools();
    const instructions = client.getInstructions() ?? '';
    const descriptionsTotal = tools.reduce((n, t) => n + (t.description?.length ?? 0), 0);
    const toolsListJson = JSON.stringify(tools);

    // Measured numbers — logged so a CI run always shows the real cost.
    // eslint-disable-next-line no-console -- test diagnostics to the console, not the MCP server itself
    console.info('[tools-list-budget]', {
      instructionsLength: instructions.length,
      descriptionsTotal,
      toolsListJsonLength: toolsListJson.length,
    });

    expect(instructions.length).toBeLessThanOrEqual(MAX_INSTRUCTIONS_CHARS);
    expect(descriptionsTotal).toBeLessThanOrEqual(MAX_DESCRIPTIONS_TOTAL_CHARS);
    expect(toolsListJson.length).toBeLessThanOrEqual(MAX_TOOLS_LIST_JSON_CHARS);
  });
});

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safe } from '../errors.js';
import { clip, toTextResult } from '../format.js';
import type { ServerDeps } from '../server.js';

const DESCRIPTION =
  'List the enabled DevDigest review agents with id, name, provider and model. Call it to get a valid agent name for run_agent_on_pr or get_findings.';

export function register(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    'list_agents',
    {
      description: DESCRIPTION,
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    () =>
      safe(async () => {
        const agents = (await deps.api.listAgents()).filter((a) => a.enabled);
        if (agents.length === 0) {
          return toTextResult({
            agents: [],
            hint: 'No enabled agents — enable one in the DevDigest studio.',
          });
        }
        // Never system_prompt / output_schema: those are the agent's internal
        // config, not something a caller picking an agent by name needs.
        return toTextResult({
          agents: agents.map((a) => ({
            id: a.id,
            name: a.name,
            description: clip(a.description, 200),
            provider: a.provider,
            model: a.model,
            enabled: a.enabled,
          })),
        });
      }),
  );
}

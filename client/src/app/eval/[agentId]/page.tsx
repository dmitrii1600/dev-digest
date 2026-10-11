import { AgentEvalView } from "./_components/AgentEvalView";

/* Route: /eval/[agentId] — one agent's eval results. Thin route entry: it only
   resolves the async `params` and hands the id to the client view. */
export default async function AgentEvalPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  return <AgentEvalView agentId={agentId} />;
}

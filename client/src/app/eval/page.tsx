import { EvalDashboardView } from "./_components/EvalDashboardView";

/* Route: /eval (Eval Dashboard landing). Thin route entry — the view, the
   per-agent cards, styles and i18n are colocated under
   _components/EvalDashboardView. `?notice=` carries a one-line reason for a redirect
   here (e.g. an agent page whose id is unknown); the view ignores any value it does
   not know. */
export default async function EvalPage({ searchParams }: { searchParams: Promise<{ notice?: string | string[] }> }) {
  const { notice } = await searchParams;
  return <EvalDashboardView notice={typeof notice === "string" ? notice : undefined} />;
}

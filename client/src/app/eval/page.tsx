import { EvalDashboardView } from "./_components/EvalDashboardView";

/* Route: /eval (Eval Dashboard landing). Thin route entry — the view, the
   per-agent cards, styles and i18n are colocated under
   _components/EvalDashboardView. */
export default async function EvalPage() {
  return <EvalDashboardView />;
}

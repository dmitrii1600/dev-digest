/* Route: /ci-runs (Global › CI Runs). Thin route entry — the view, which owns
   the client boundary, is colocated under _components/CiRunsView. The Suspense
   boundary is for the view's useSearchParams (the agent/repo filters). */
import { Suspense } from "react";
import { CiRunsView } from "./_components/CiRunsView";

export default async function CiRunsPage() {
  return (
    <Suspense>
      <CiRunsView />
    </Suspense>
  );
}

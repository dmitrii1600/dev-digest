/* Route: /repos/:repoId/tour (Workspace › Onboarding Tour). Thin route entry —
   the view, styles and helpers are colocated under _components/OnboardingTourView,
   which owns the client boundary. The API it reads is /repos/:id/onboarding. */
import { OnboardingTourView } from "./_components/OnboardingTourView";

export default async function OnboardingTourPage({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  return <OnboardingTourView repoId={repoId} />;
}

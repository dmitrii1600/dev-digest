/* Route: /repos/:repoId/context (Workspace › Project Context). Thin route
   entry — the view, styles and helpers are colocated under
   _components/ProjectContextView, which owns the client boundary. */
import { ProjectContextView } from "./_components/ProjectContextView";

export default async function ProjectContextPage({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  return <ProjectContextView repoId={repoId} />;
}

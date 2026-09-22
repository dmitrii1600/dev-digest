/* Route: /repos/:repoId/conventions (Skills Lab › Conventions). Thin route
   entry — the view, the candidate cards, the Create-skill modal, styles,
   helpers and i18n are colocated under _components/ConventionsView. */
"use client";

import { useParams } from "next/navigation";
import { ConventionsView } from "./_components/ConventionsView";

export default function ConventionsPage() {
  const params = useParams<{ repoId: string }>();
  return <ConventionsView repoId={params.repoId} />;
}

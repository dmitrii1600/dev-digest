import { MultiReviewView } from "./_components/MultiReviewView";

/* Route: /multi-agent/[multiRunId] — results of one multi-agent review. Thin
   route entry; the view and its polling live under _components/MultiReviewView. */
export default async function MultiReviewPage({ params }: { params: Promise<{ multiRunId: string }> }) {
  const { multiRunId } = await params;
  return <MultiReviewView id={multiRunId} />;
}

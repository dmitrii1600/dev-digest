/* ContextTab — agent editor Context tab. Attach / reorder the active repo's
   clone Markdown documents; the mutation persists the whole ordered list. */
"use client";

import React from "react";
import { ContextDocsPicker } from "@/components/context-docs-picker";
import { useAgentContext, useContextFiles, useSetAgentContext } from "@/lib/hooks/project-context";
import { useActiveRepo } from "@/providers/repo-context";

export function ContextTab({ agentId }: { agentId: string }) {
  const { repoId } = useActiveRepo();
  const list = useContextFiles(repoId);
  const attached = useAgentContext(agentId, repoId);
  const set = useSetAgentContext(agentId, repoId);

  return (
    <ContextDocsPicker
      repoId={repoId}
      list={list.data}
      listState={{
        isLoading: list.isLoading || attached.isLoading,
        isError: list.isError || attached.isError,
        onRetry: () => {
          void list.refetch();
          void attached.refetch();
        },
      }}
      attached={attached.data?.paths ?? []}
      onChange={(paths) => set.mutate({ paths })}
    />
  );
}

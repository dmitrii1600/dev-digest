/* ContextTab — skill editor Context tab. Same picker over the skill's own
   attachments; any agent using the skill inherits them at run time. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ContextDocsPicker } from "@/components/context-docs-picker";
import { useContextFiles, useSetSkillContext, useSkillContext } from "@/lib/hooks/project-context";
import { useActiveRepo } from "@/providers/repo-context";
import { s } from "./styles";

export function ContextTab({ skillId }: { skillId: string }) {
  const t = useTranslations("context");
  const { repoId } = useActiveRepo();
  const list = useContextFiles(repoId);
  const attached = useSkillContext(skillId, repoId);
  const set = useSetSkillContext(skillId, repoId);
  const paths = attached.data?.paths ?? [];

  return (
    <div>
      <p style={s.inherits}>{t("skillTab.inherits")}</p>
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
        attached={paths}
        onChange={(next) => set.mutate({ paths: next })}
      />
      {paths.length > 0 && (
        <div style={s.box}>
          <div style={s.boxLabel}>{t("skillTab.serializesAs")}</div>
          <div data-testid="serializes-as" className="mono" style={s.boxBody}>
            {paths.join("\n")}
          </div>
        </div>
      )}
    </div>
  );
}

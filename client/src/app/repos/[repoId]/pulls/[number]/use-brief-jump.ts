/* use-brief-jump.ts — the Overview tab's "jump to Files changed" action. A risk
   or review-focus ref (`src/a.ts:12`, `./src/a.ts:12-30`) becomes
   `?tab=diff&file=&line=` via `router.push`, so Back returns to Overview and
   Back/Forward restore the target. A ref that is not a changed file (a
   blast-map-only file) stays on Overview and says so. Lives in the page
   segment because only this route uses it and it needs the route's params. */
"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { notify } from "@/providers/toast";
import { diffTargetHref, isInDiff, parseFileRef } from "./diff-target";

export function useBriefJump({
  repoId,
  number,
  diffPaths,
}: {
  repoId: string;
  number: string;
  diffPaths: string[];
}): (ref: string) => void {
  const router = useRouter();
  const search = useSearchParams();
  const t = useTranslations("brief");
  const searchString = search.toString();

  return useCallback(
    (ref: string) => {
      const target = parseFileRef(ref);
      if (!isInDiff(target.file, diffPaths)) {
        notify.info(t("notInDiff"));
        return;
      }
      router.push(diffTargetHref(`/repos/${repoId}/pulls/${number}`, searchString, target));
    },
    [router, searchString, repoId, number, diffPaths, t],
  );
}

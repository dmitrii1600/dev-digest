/* DiffGroup — one role's section of the Files changed tab (Smart Diff, L03):
   a sticky, togglable header (label, hint, findings counter, file count) and,
   when open, the group's files rendered through the generic DiffViewer. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PrFile, SmartDiffRole } from "@devdigest/shared";
import { Icon } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi, type DiffFindingApi } from "@/components/diff-viewer";
import { COLLAPSED_BY_DEFAULT } from "../../constants";
import { s, chevronFor, ROLE_COLOR } from "./styles";

export function DiffGroup({
  role,
  files,
  filesWithFindings,
  hasReview,
  commenting,
  findings,
  targetPath,
}: {
  role: SmartDiffRole;
  files: PrFile[];
  filesWithFindings: number;
  hasReview: boolean;
  commenting?: DiffCommentApi;
  findings?: DiffFindingApi;
  /** The file the URL points at: a group holding it opens even when it is
      collapsed by default, until the user toggles it. */
  targetPath?: string | null;
}) {
  const t = useTranslations("prReview");
  // `userOpen` is null until the user clicks the header; while null, `open` is
  // derived — so a target arriving after mount (Smart Diff settling) still opens it.
  const [userOpen, setUserOpen] = React.useState<boolean | null>(null);
  const hasTarget = !!targetPath && files.some((f) => f.path === targetPath);
  const open = userOpen ?? (hasTarget || !COLLAPSED_BY_DEFAULT.has(role));

  return (
    <div style={s.wrap}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setUserOpen(!open)}
        style={s.header}
      >
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <span aria-hidden style={{ ...s.roleSwatch, background: ROLE_COLOR[role] }} />
        <span style={s.label}>{t(`smartDiff.${role}Label`)}</span>
        <span style={s.hint}>{t(`smartDiff.${role}Hint`)}</span>
        <span style={s.right}>
          {hasReview && filesWithFindings > 0 && (
            <span style={s.findingsCounter}>
              &#9679; {t("smartDiff.filesWithFindings", { count: filesWithFindings })}
            </span>
          )}
          <span>{t("smartDiff.filesCount", { count: files.length })}</span>
        </span>
      </button>
      {open && files.length > 0 && (
        <DiffViewer files={files} commenting={commenting} findings={findings} targetPath={targetPath} />
      )}
    </div>
  );
}

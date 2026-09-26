/* DiffTab — Files changed. Smart order (default): five role groups with
   findings shown inline. Original order: today's flat GitHub-order list. One
   Show/Hide toggle covers GitHub comments and findings (spec decision 2:
   shown by default). See `helpers.ts` for the view-model rules this owns. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi, type DiffFindingApi } from "@/components/diff-viewer";
import {
  usePrComments,
  useCreatePrComment,
  usePrReviews,
  useFindingAction,
  useSmartDiff,
} from "@/lib/hooks/reviews";
import { notify } from "@/providers/toast";
import type { FindingRecord, PrFile } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { DiffGroup } from "./_components/DiffGroup";
import { findingsByPath, groupFiles, latestFindingsPerAgent } from "./helpers";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
}

type OrderMode = "smart" | "original";

export function DiffTab({ prId, filesCount, files, canComment }: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  const { data: reviews } = usePrReviews(prId);
  const { data: smartDiff } = useSmartDiff(prId);
  const action = useFindingAction();

  // Comments (and findings) show by default — spec decision 2. Today's flat
  // view used to default this to false; the toggle now covers both.
  const [showComments, setShowComments] = React.useState(true);
  const [order, setOrder] = React.useState<OrderMode>("smart");

  const commentCount = comments?.length ?? 0;
  const hasReview = (reviews ?? []).some((r) => r.kind === "review");

  const findings = React.useMemo(() => latestFindingsPerAgent(reviews), [reviews]);
  const byPath = React.useMemo(() => findingsByPath(findings), [findings]);
  const groups = React.useMemo(() => groupFiles(files, smartDiff), [files, smartDiff]);

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : t("smartDiff.postCommentFailed"));
        throw err;
      }
    },
  };

  const renderFinding = React.useCallback(
    (f: FindingRecord) => (
      <FindingCard
        f={f}
        defaultExpanded
        onAction={(a) => {
          if (prId) action.mutate({ findingId: f.id, action: a, prId });
        }}
        pending={action.isPending}
      />
    ),
    [action, prId],
  );

  const findingApi: DiffFindingApi = React.useMemo(
    () => ({
      byPath,
      renderFinding,
      // The viewer must not hardcode the one-toggle rule (architecture
      // SUGGESTION 2) — DiffTab is the one place that knows Show/Hide covers
      // both comments and findings, so it hands the viewer the resolved flag.
      visible: showComments,
      labels: {
        sevTag: (sev) => t(`smartDiff.sevTag.${sev}`),
        outsideDiff: (count) => t("smartDiff.findingsOutsideDiff", { count }),
        fileDot: (count) => t("smartDiff.findingsOnFile", { count }),
      },
    }),
    [byPath, renderFinding, showComments, t],
  );

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {(commentCount > 0 || findings.length > 0) && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments
                  ? t("smartDiff.hideComments", { count: commentCount })
                  : t("smartDiff.showComments", { count: commentCount })}
              </Button>
            )}
            <Button
              kind={order === "smart" ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={order === "smart"}
              onClick={() => setOrder("smart")}
            >
              {t("smartDiff.smartOrder")}
            </Button>
            <Button
              kind={order === "original" ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={order === "original"}
              onClick={() => setOrder("original")}
            >
              {t("smartDiff.originalOrder")}
            </Button>
          </div>
        }
      >
        {t("smartDiff.filesChanged", { count: filesCount })}
      </SectionLabel>

      {order === "smart" && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 10px" }}>
          {t("smartDiff.reviewerOrdered")}
        </p>
      )}

      {!hasReview && (
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 10px" }}>
          {t("smartDiff.noReviewYet")}
        </p>
      )}

      {order === "original" ? (
        <DiffViewer files={files} commenting={commenting} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {groups.map((g) => (
            <DiffGroup
              key={g.role}
              role={g.role}
              files={g.files}
              filesWithFindings={g.files.filter((f) => (byPath.get(f.path)?.length ?? 0) > 0).length}
              hasReview={hasReview}
              commenting={commenting}
              findings={findingApi}
            />
          ))}
        </div>
      )}
    </section>
  );
}

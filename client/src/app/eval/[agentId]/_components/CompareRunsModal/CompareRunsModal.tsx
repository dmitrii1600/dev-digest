/* CompareRunsModal — two runs of one agent, older → newer. The server answers
   the metric deltas, the case-set diff and the model / skill-set flags; the
   system-prompt diff is computed here from each run's agent-version snapshot.
   A snapshot that cannot be read costs only the diff: the deltas still show
   (EC-11). A "not available" metric reads "—" (EC-8). Each run also has a
   "Promote vX" action that restores that run's configuration as a new agent
   version, after a confirmation that lists what would change. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, Skeleton } from "@devdigest/ui";
import type { EvalRunComparison } from "@devdigest/shared";
import { diffLines, isUnchanged, lineRowFor, lineSignFor } from "@/components/diff-viewer";
import { MetricDelta, formatCost, formatCostDelta, formatMetric, formatRunDate } from "@/components/eval-metrics";
import { useAgentVersion } from "@/lib/hooks/agents";
import { useEvalRunComparison } from "@/lib/hooks/evals";
import { PromoteConfirm } from "./_components/PromoteConfirm";
import { s } from "./styles";
import { usePromotion } from "./usePromotion";

const METRIC_ROWS = [
  { key: "recall", legendKey: "dashboard.legend.recall" },
  { key: "precision", legendKey: "dashboard.legend.precision" },
  { key: "citation_accuracy", legendKey: "dashboard.legend.citation" },
] as const;

export function CompareRunsModal({
  agentId,
  runIds,
  onClose,
}: {
  agentId: string;
  runIds: [string, string];
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const { data, isLoading, isError } = useEvalRunComparison(agentId, runIds[0], runIds[1]);
  const promotion = usePromotion(agentId, data, onClose);

  return (
    <>
      <Modal
        width={760}
        title={t("compare.title")}
        subtitle={data ? t("compare.olderNewer", { older: formatRunDate(data.older.started_at), newer: formatRunDate(data.newer.started_at) }) : undefined}
        onClose={onClose}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
            {promotion.targets.map(({ run, status }) => (
              <Button
                key={run.id}
                kind="secondary"
                disabled={status !== "ready"}
                onClick={() => promotion.open(run.id)}
              >
                {status === "current"
                  ? t("compare.promoteCurrent")
                  : status === "unreadable"
                    ? t("compare.promoteUnreadable", { version: run.agent_version })
                    : t("compare.promote", { version: run.agent_version })}
              </Button>
            ))}
            <Button kind="ghost" onClick={onClose}>
              {t("compare.close")}
            </Button>
          </div>
        }
      >
        <div style={s.body}>
          {isLoading ? (
            <Skeleton height={160} />
          ) : isError || !data ? (
            <div role="alert" style={s.error}>
              {t("compare.loadError")}
            </div>
          ) : (
            <ComparisonBody agentId={agentId} cmp={data} />
          )}
        </div>
      </Modal>
      {promotion.target?.diff && (
        <PromoteConfirm
          version={promotion.target.run.agent_version}
          diff={promotion.target.diff}
          pending={promotion.pending}
          error={promotion.error}
          onConfirm={promotion.confirm}
          onCancel={promotion.cancel}
        />
      )}
    </>
  );
}

function ComparisonBody({ agentId, cmp }: { agentId: string; cmp: EvalRunComparison }) {
  const t = useTranslations("eval");
  const { older, newer, deltas, case_sets } = cmp;
  return (
    <>
      {!case_sets.same && (
        <div role="alert" style={s.warn}>
          {t("compare.caseSetsDiffer", {
            olderCount: case_sets.older_count,
            newerCount: case_sets.newer_count,
            editedCount: case_sets.edited_count,
          })}
        </div>
      )}
      <table style={s.table}>
        <tbody>
          {METRIC_ROWS.map(({ key, legendKey }) => (
            <tr key={key}>
              <th scope="row" style={{ ...s.th, textTransform: "none", fontSize: 13 }}>
                {t(legendKey)}
              </th>
              <td className="tnum" style={s.td}>
                {t("compare.olderNewer", {
                  older: formatMetric(older.metrics[key]),
                  newer: formatMetric(newer.metrics[key]),
                })}
              </td>
              <td style={s.td}>
                <MetricDelta value={deltas[key]} unit="points" />
              </td>
            </tr>
          ))}
          <tr>
            <th scope="row" style={{ ...s.th, textTransform: "none", fontSize: 13 }}>
              {t("compare.cost")}
            </th>
            <td className="tnum" style={s.td}>
              {t("compare.olderNewer", { older: formatCost(older.cost_usd), newer: formatCost(newer.cost_usd) })}
            </td>
            <td className="tnum" style={s.td}>
              {formatCostDelta(deltas.cost_usd)}
            </td>
          </tr>
        </tbody>
      </table>
      {cmp.model_changed && <div style={s.note}>{t("compare.modelChanged")}</div>}
      {cmp.skills_changed && <div style={s.note}>{t("compare.skillsChanged")}</div>}
      <PromptDiff agentId={agentId} olderVersion={older.agent_version} newerVersion={newer.agent_version} />
    </>
  );
}

function PromptDiff({
  agentId,
  olderVersion,
  newerVersion,
}: {
  agentId: string;
  olderVersion: number;
  newerVersion: number;
}) {
  const t = useTranslations("eval");
  const olderQ = useAgentVersion(agentId, olderVersion);
  const newerQ = useAgentVersion(agentId, newerVersion);
  const before = olderQ.data?.config.system_prompt;
  const after = newerQ.data?.config.system_prompt;
  const lines = React.useMemo(
    () => (before != null && after != null ? diffLines(before, after) : null),
    [before, after],
  );

  let content: React.ReactNode;
  if (olderQ.isError || newerQ.isError) {
    content = <div style={s.diffEmpty}>{t("compare.promptDiffUnavailable")}</div>;
  } else if (!lines) {
    content = <Skeleton height={80} />;
  } else if (isUnchanged(lines)) {
    content = <div style={s.diffEmpty}>{t("compare.promptUnchanged")}</div>;
  } else {
    content = (
      <div className="mono" style={s.diffLines}>
        {lines.map((ln, i) => (
          <div key={i} style={lineRowFor(ln.kind)}>
            <span style={s.lineNo}>{ln.oldNo ?? ""}</span>
            <span style={s.lineNo}>{ln.newNo ?? ""}</span>
            <span style={lineSignFor(ln.kind)}>{ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : ""}</span>
            <span style={s.lineText}>{ln.text}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div>
      <div style={{ ...s.sectionTitle, marginBottom: 8 }}>{t("compare.promptDiff")}</div>
      <div style={s.diffBox}>{content}</div>
    </div>
  );
}

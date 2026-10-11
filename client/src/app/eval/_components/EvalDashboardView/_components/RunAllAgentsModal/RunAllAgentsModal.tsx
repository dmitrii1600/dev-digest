/* RunAllAgentsModal — confirm, then report, "Run all agents". The confirmation lists
   each eligible agent (enabled, at least one case) with its case count and latest cost,
   the number of paid review calls and the estimated cost ("—" for an agent never run).
   After confirming, one text line per agent says started or skipped and why — a skipped
   agent never stops the others. Escape, Cancel and the X close without starting anything. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import type { EvalAgentCard } from "@devdigest/shared";
import { formatCost } from "@/components/eval-metrics";
import { ApiError } from "@/lib/api";
import { useRunAllAgents } from "@/lib/hooks/evals";
import { REASON_KEY, runAllSummary } from "./helpers";
import { s } from "./styles";

export function RunAllAgentsModal({ cards, onClose }: { cards: EvalAgentCard[]; onClose: () => void }) {
  const t = useTranslations("eval");
  const runAll = useRunAllAgents();
  const summary = React.useMemo(() => runAllSummary(cards), [cards]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const outcomes = runAll.data?.outcomes;
  const error = !runAll.isError
    ? null
    : runAll.error instanceof ApiError && runAll.error.code === "eval_run_all_in_progress"
      ? t("dashboard.runAllInProgress")
      : runAll.error.message;

  return (
    <Modal
      width={520}
      title={t("dashboard.runAllTitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {outcomes ? (
            <Button kind="secondary" onClick={onClose}>
              {t("compare.close")}
            </Button>
          ) : (
            <>
              <Button kind="ghost" onClick={onClose} disabled={runAll.isPending}>
                {t("dashboard.runAllCancel")}
              </Button>
              <Button
                kind="primary"
                icon="Play"
                loading={runAll.isPending}
                disabled={summary.eligible.length === 0}
                onClick={() => runAll.mutate()}
              >
                {t("dashboard.runAllConfirm")}
              </Button>
            </>
          )}
        </div>
      }
    >
      <div style={s.body}>
        {outcomes ? (
          <ul style={s.list}>
            {outcomes.map((o) => (
              <li key={o.agent_id}>
                {o.status === "started" || !o.reason
                  ? t("dashboard.runAllStarted", { agent: o.agent_name })
                  : t("dashboard.runAllSkipped", {
                      agent: o.agent_name,
                      reason: t(`dashboard.${REASON_KEY[o.reason]}`),
                    })}
              </li>
            ))}
          </ul>
        ) : (
          <>
            <ul style={s.list}>
              {summary.eligible.map((c) => (
                <li key={c.agent_id} style={s.row}>
                  <span style={s.name}>{c.agent_name}</span>
                  <span className="tnum">{t("dashboard.runAllCases", { count: c.cases_total })}</span>
                  <span className="tnum" style={s.cost}>
                    {formatCost(c.latest?.cost_usd)}
                  </span>
                </li>
              ))}
            </ul>
            <div style={s.total}>
              {t("dashboard.runAllTotal", { calls: summary.calls, cost: formatCost(summary.estimate) })}
            </div>
            {summary.unknownCount > 0 && (
              <div style={s.muted}>{t("dashboard.runAllUnknown", { count: summary.unknownCount })}</div>
            )}
          </>
        )}
        {error && (
          <div role="alert" style={s.error}>
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

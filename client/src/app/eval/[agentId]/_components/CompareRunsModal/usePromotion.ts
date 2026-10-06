/* usePromotion — the Promote vX state of the Compare modal: for each of the two runs, whether
   its recorded configuration can be promoted and what that would change, plus the confirm flow.
   The agent version the user was looking at is captured ONCE, when the agent first loads after
   the modal opens, and sent as `expected_version`: if the agent changes meanwhile, the server
   answers 409 and nothing is written (EC-4). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { EvalRunComparison, EvalSuiteRun } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useAgent, useAgentSkillLinks, useAgentVersion, usePromoteAgent } from "@/lib/hooks/agents";
import { useSkills } from "@/lib/hooks/skills";
import { useToast } from "@/providers/toast";
import { promotionDiff, type PromotionDiff } from "./helpers";

export interface PromoteTarget {
  run: EvalSuiteRun;
  /** `current` = same configuration as the agent now (EC-1); `unreadable` = snapshot missing (EC-5). */
  status: "loading" | "unreadable" | "current" | "ready";
  diff: PromotionDiff | null;
}

export function usePromotion(agentId: string, comparison: EvalRunComparison | undefined, onPromoted: () => void) {
  const t = useTranslations("eval");
  const toast = useToast();
  const { data: agent } = useAgent(agentId);
  const links = useAgentSkillLinks(agentId);
  const skills = useSkills();
  const older = useAgentVersion(agentId, comparison?.older.agent_version);
  const newer = useAgentVersion(agentId, comparison?.newer.agent_version);
  const promote = usePromoteAgent(agentId);
  const [confirming, setConfirming] = React.useState<string | null>(null);

  const expectedVersion = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (expectedVersion.current == null && agent) expectedVersion.current = agent.version;
  }, [agent]);

  const targets = React.useMemo<PromoteTarget[]>(() => {
    if (!comparison) return [];
    return [
      { run: comparison.older, snap: older },
      { run: comparison.newer, snap: newer },
    ].map(({ run, snap }): PromoteTarget => {
      if (snap.isError) return { run, status: "unreadable", diff: null };
      if (!snap.data || !agent || !links.data || !skills.data) return { run, status: "loading", diff: null };
      const diff = promotionDiff(snap.data.config, run, agent, links.data, skills.data);
      return { run, status: diff.same ? "current" : "ready", diff };
    });
  }, [comparison, older, newer, agent, links.data, skills.data]);

  const target = targets.find((x) => x.run.id === confirming) ?? null;

  const confirm = () => {
    if (!target || expectedVersion.current == null) return;
    promote.mutate(
      {
        from_version: target.run.agent_version,
        eval_run_id: target.run.id,
        expected_version: expectedVersion.current,
      },
      {
        onSuccess: (updated) => {
          toast.success(t("compare.promoted", { version: updated.version }));
          onPromoted();
        },
      },
    );
  };

  const cancel = () => {
    promote.reset();
    setConfirming(null);
  };

  const error = !promote.isError
    ? null
    : promote.error instanceof ApiError && promote.error.status === 409
      ? t("compare.promoteConflict")
      : promote.error.message;

  return { targets, target, open: setConfirming, confirm, cancel, pending: promote.isPending, error };
}

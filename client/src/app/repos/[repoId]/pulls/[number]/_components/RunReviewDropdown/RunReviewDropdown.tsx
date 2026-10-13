/* RunReviewDropdown — agent picker. Check the agents to run: one agent starts
   the existing single-agent review (POST /pulls/:id/review) and hands its runIds
   up for live SSE status; two or more start a multi-agent review and open its
   results page. The vendored Dropdown closes on every item click, so the panel
   is a small local popover. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox } from "@devdigest/ui";
import { AgentAvatar } from "@/components/agent-avatar";
import { useAgents } from "@/lib/hooks/agents";
import { useStartMultiReview, useAgentRunEstimates } from "@/lib/hooks/multi-review";
import { useRunReview } from "@/lib/hooks/reviews";
import { hintSeconds } from "@/lib/run-estimates";
import { DROPDOWN_WIDTH } from "./constants";
import { s } from "./styles";

export function RunReviewDropdown({
  prId,
  size = "sm",
  kind = "primary",
  warnMerged = false,
  onRunStart,
  onRunsStarted,
  onRunSettled,
}: {
  prId: string;
  size?: "sm" | "md" | "lg";
  kind?: "primary" | "secondary";
  /** PR is already merged/closed — dim the trigger and warn, but still allow. */
  warnMerged?: boolean;
  /** Fired the moment a run is kicked off (before it completes). */
  onRunStart?: () => void;
  onRunsStarted?: (runIds: string[]) => void;
  /** Fired when the run request settles (success or error). */
  onRunSettled?: () => void;
}) {
  const t = useTranslations("prReview");
  const m = useTranslations("multiReview");
  const router = useRouter();
  const { data: agents } = useAgents();
  const { data: estimates } = useAgentRunEstimates();
  const run = useRunReview();
  const multi = useStartMultiReview();

  const [open, setOpen] = React.useState(false);
  const [multiFailed, setMultiFailed] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  // null = untouched → every enabled agent is checked (derived, so agents that
  // load late are included without an effect).
  const [picked, setPicked] = React.useState<Set<string> | null>(null);

  React.useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const enabled = (agents ?? []).filter((a) => a.enabled);
  const checked = picked ?? new Set(enabled.map((a) => a.id));
  const chosen = enabled.filter((a) => checked.has(a.id));
  const allChecked = enabled.length > 0 && chosen.length === enabled.length;
  const pending = run.isPending || multi.isPending;

  const toggle = (id: string, on: boolean) => {
    const next = new Set(checked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };

  const start = async () => {
    if (chosen.length === 0) return;
    setOpen(false);
    if (chosen.length === 1) {
      onRunStart?.();
      try {
        const res = await run.mutateAsync({ prId, agentId: chosen[0]!.id });
        onRunsStarted?.(res.runs.map((r) => r.run_id));
      } finally {
        onRunSettled?.();
      }
      return;
    }
    setMultiFailed(false);
    try {
      const res = await multi.mutateAsync({ prId, agentIds: chosen.map((a) => a.id) });
      router.push(`/multi-agent/${res.multi_run_id}`);
    } catch {
      setMultiFailed(true);
      setOpen(true);
    }
  };

  const runLabel =
    chosen.length === 0
      ? m("picker.selectAnAgent")
      : chosen.length === 1
        ? m("picker.runOne", { name: chosen[0]!.name })
        : m("picker.runMulti", { count: chosen.length });

  return (
    <div ref={ref} style={s.root}>
      <span
        title={warnMerged ? t("runReview.mergedTooltip") : undefined}
        style={warnMerged ? { opacity: 0.6 } : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Button kind={kind} size={size} iconRight="ChevronDown" icon="Sparkles" loading={pending}>
          {pending ? t("runReview.running") : t("runReview.runReview")}
        </Button>
      </span>
      {open && (
        <div style={{ ...s.panel, width: DROPDOWN_WIDTH }}>
          {warnMerged && <div style={s.warn}>{t("runReview.mergedWarning")}</div>}
          {enabled.length === 0 ? (
            <div style={s.empty}>
              <span>{m("picker.noEnabled")}</span>
              <button type="button" style={s.link} onClick={() => router.push("/agents")}>
                {m("picker.goToAgents")}
              </button>
            </div>
          ) : (
            <>
              <div style={s.header}>
                <span style={s.headerTitle}>{m("picker.header")}</span>
                <button
                  type="button"
                  style={s.link}
                  onClick={() => setPicked(allChecked ? new Set() : new Set(enabled.map((a) => a.id)))}
                >
                  {allChecked ? m("picker.clear") : m("picker.selectAll")}
                </button>
              </div>
              {enabled.map((a) => {
                const secs = hintSeconds(estimates?.find((e) => e.agent_id === a.id));
                return (
                  <div key={a.id} style={s.row}>
                    <Checkbox
                      checked={checked.has(a.id)}
                      onChange={(v) => toggle(a.id, v)}
                      label={
                        <span style={s.agentLabel}>
                          <AgentAvatar name={a.name} size="sm" />
                          <span style={s.agentName}>{a.name}</span>
                        </span>
                      }
                    />
                    <span style={s.hint}>
                      {secs == null ? m("picker.unknown") : m("picker.timeHint", { seconds: secs })}
                    </span>
                  </div>
                );
              })}
              {multiFailed && (
                <div role="alert" style={s.warn}>
                  {m("picker.startFailed")}
                </div>
              )}
              <div style={s.runBar}>
                <Button kind="primary" size="sm" disabled={chosen.length === 0 || pending} onClick={start}>
                  {runLabel}
                </Button>
              </div>
            </>
          )}
          <button type="button" style={s.configure} onClick={() => router.push("/agents")}>
            {m("picker.configureAgents")}
          </button>
        </div>
      )}
    </div>
  );
}

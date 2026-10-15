/* CiRunsTable — the CI runs table shared by the agent CI tab and /ci-runs.
   Status and severity are text (with an icon), never colour alone: the counts
   carry a visually hidden sentence. Rows render in the order received (the API
   sends newest first). PR title and agent name are untrusted: rendered as plain
   text, CSS-truncated. */
import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV, type Severity } from "@devdigest/ui";
import type { CiRun } from "@devdigest/shared";
import { formatCost, formatDuration, reasonKey, statusKey } from "./helpers";
import { useRelativeTime } from "./useRelativeTime";
import { StatusPill } from "./StatusPill";
import { s } from "./styles";

const SR_ONLY: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};

function SeverityCount({ sev, n }: { sev: Severity; n: number | null | undefined }) {
  if (!n) return null;
  const I = Icon[SEV[sev].icon];
  return (
    <span style={{ ...s.count, color: SEV[sev].c }} aria-hidden>
      <I size={13} />
      {n}
    </span>
  );
}

export function CiRunsTable({ runs, showAgent }: { runs: CiRun[]; showAgent: boolean }) {
  const t = useTranslations("ci");
  const ago = useRelativeTime();
  const headers = [
    t("runs.table.timestamp"),
    t("runs.table.pullRequest"),
    ...(showAgent ? [t("runs.table.agent")] : []),
    t("runs.table.repository"),
    t("runs.table.duration"),
    t("runs.table.findings"),
    t("runs.table.cost"),
    t("runs.table.status"),
    t("runs.table.job"),
  ];
  return (
    <div style={s.card}>
      <table style={s.table}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} style={s.th} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((r, i) => {
            const td = i === runs.length - 1 ? s.lastTd : s.td;
            const sk = statusKey(r.status);
            const rk = reasonKey(r.failure_reason);
            const total = (r.critical ?? 0) + (r.warning ?? 0) + (r.suggestion ?? 0);
            const hasCounts = r.critical != null || r.warning != null || r.suggestion != null;
            return (
              <tr key={r.id}>
                <td style={td}>
                  <span style={s.mono}>{ago(r.ran_at)}</span>
                </td>
                <td style={td}>
                  {r.pr_number != null && <span style={s.prNum}>#{r.pr_number}</span>}
                  <span style={s.prTitle}>{r.pr_title ?? ""}</span>
                </td>
                {showAgent && (
                  <td style={td}>
                    <span style={s.agent}>
                      <Icon.Cpu size={13} />
                      {r.agent ?? "—"}
                    </span>
                  </td>
                )}
                <td style={td}>
                  <span style={s.repo}>{r.repo ?? "—"}</span>
                </td>
                <td style={td}>
                  <span style={s.strong}>{formatDuration(r.duration_s)}</span>
                </td>
                <td style={td}>
                  {hasCounts ? (
                    <span style={s.counts}>
                      <span style={SR_ONLY}>
                        {t("runs.severity", {
                          critical: r.critical ?? 0,
                          warning: r.warning ?? 0,
                          suggestion: r.suggestion ?? 0,
                        })}
                      </span>
                      <SeverityCount sev="CRITICAL" n={r.critical} />
                      <SeverityCount sev="WARNING" n={r.warning} />
                      <SeverityCount sev="SUGGESTION" n={r.suggestion} />
                      {total === 0 && (
                        <span style={s.muted} aria-hidden>
                          —
                        </span>
                      )}
                    </span>
                  ) : (
                    <span style={s.muted}>—</span>
                  )}
                </td>
                <td style={td}>
                  <span style={s.mono}>{formatCost(r.cost_usd)}</span>
                </td>
                <td style={td}>
                  {sk ? <StatusPill status={sk} /> : <span style={s.muted}>—</span>}
                  {rk && <span style={s.reason}>{t(`runs.reason.${rk}`)}</span>}
                </td>
                <td style={td}>
                  {r.github_url ? (
                    <a href={r.github_url} target="_blank" rel="noopener noreferrer" style={s.link}>
                      {t("runs.viewJob")}
                    </a>
                  ) : (
                    <span style={s.muted}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

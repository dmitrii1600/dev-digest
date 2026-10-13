/* CiRunsView — /ci-runs: every CI run across agents and repositories, newest
   first. Refreshes from GitHub once on mount and on demand; a refresh failure
   shows an error with retry while the stored runs stay on screen. */
"use client";

import React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { CiRunsTable } from "@/components/ci-runs-table";
import { useAgents, useRepos } from "@/lib/hooks";
import { useCiRuns, useRefreshCiRuns } from "@/lib/hooks/ci";
import { s } from "./styles";

export function CiRunsView() {
  const t = useTranslations("ci");
  const search = useSearchParams();
  const router = useRouter();
  const agentId = search.get("agent") ?? "";
  const repoId = search.get("repo") ?? "";
  const setFilter = (key: "agent" | "repo", value: string) => {
    const sp = new URLSearchParams(search.toString());
    if (value) sp.set(key, value);
    else sp.delete(key);
    const qs = sp.toString();
    router.replace(qs ? `/ci-runs?${qs}` : "/ci-runs");
  };
  const { data: agents } = useAgents();
  const { data: repos } = useRepos();
  const runsQuery = useCiRuns({ agentId: agentId || undefined, repoId: repoId || undefined });
  const refresh = useRefreshCiRuns();

  const refreshed = React.useRef(false);
  const { mutate: refreshMutate } = refresh;
  React.useEffect(() => {
    if (refreshed.current) return;
    refreshed.current = true;
    refreshMutate({});
  }, [refreshMutate]);

  const runs = runsQuery.data;
  const unfiltered = !agentId && !repoId;

  return (
    <AppShell crumb={[{ label: t("page.crumb") }]}>
      <div style={s.page}>
        <div style={s.head}>
          <div>
            <h1 style={s.h1}>{t("runs.title")}</h1>
            <p style={s.subtitle}>{t("runs.subtitle")}</p>
          </div>
          <div style={s.controls}>
            <Button kind="secondary" icon="RefreshCw" disabled={refresh.isPending} onClick={() => refresh.mutate({})}>
              {refresh.isPending ? t("runs.refreshing") : t("runs.refresh")}
            </Button>
          </div>
        </div>

        <div style={s.filters}>
          <label style={s.filter(!!agentId)}>
            <Icon.Cpu size={14} />
            <select
              aria-label={t("runs.table.agent")}
              value={agentId}
              onChange={(e) => setFilter("agent", e.target.value)}
              style={s.select}
            >
              <option value="">{t("runs.filters.allAgents")}</option>
              {(agents ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label style={s.filter(!!repoId)}>
            <Icon.GitBranch size={14} />
            <select
              aria-label={t("runs.table.repository")}
              value={repoId}
              onChange={(e) => setFilter("repo", e.target.value)}
              style={s.select}
            >
              <option value="">{t("runs.filters.allRepos")}</option>
              {(repos ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.full_name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {refresh.isError && <ErrorState title={t("runs.refreshError")} onRetry={() => refresh.mutate({})} />}

        {runsQuery.isError ? (
          <ErrorState title={t("runs.loadError")} onRetry={() => runsQuery.refetch()} />
        ) : runsQuery.isLoading || !runs ? (
          <Skeleton height={200} />
        ) : runs.length === 0 && unfiltered ? (
          <>
            <EmptyState icon="Zap" title={t("runs.emptyTitle")} body={t("runs.emptyBody")} />
            <Link href="/agents" style={{ textAlign: "center" }}>
              {t("runs.emptyCta")}
            </Link>
          </>
        ) : runs.length === 0 ? (
          <p style={s.subtitle}>{t("runs.noMatches")}</p>
        ) : (
          <CiRunsTable runs={runs} showAgent />
        )}
      </div>
    </AppShell>
  );
}

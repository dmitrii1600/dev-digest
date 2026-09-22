"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Skeleton } from "@devdigest/ui";
import type { Skill, SkillVersion } from "@devdigest/shared";
import { lineRowFor, lineSignFor } from "@/components/diff-viewer";
import { useSkillVersions, useRestoreSkillVersion } from "@/lib/hooks/skills";
import { useToast } from "@/providers/toast";
import { diffLines, isUnchanged } from "./diff";
import { currentVersion, formatVersionDate, isCurrent } from "./helpers";
import { s } from "./styles";

/** Version history, newest first, with Restore and an inline diff. Restore
 *  APPENDS a new version copying the chosen body — it never rewinds history, so
 *  it still gets a confirm even though nothing is destroyed. The diff on a
 *  non-current row reads vN → v(current): what the current body changed since
 *  that version, i.e. what restoring it would undo. The current row has no
 *  diff — it would be empty. */
export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const restore = useRestoreSkillVersion();
  const [openDiff, setOpenDiff] = React.useState<number | null>(null);

  const onRestore = (version: number) => {
    if (!window.confirm(t("versions.restoreConfirm", { version }))) return;
    restore.mutate(
      { id: skill.id, version },
      {
        onSuccess: (data) =>
          toast.success(t("versions.restoreToast", { version, newVersion: data.version })),
      },
    );
  };

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={72} style={{ marginBottom: 10 }} />
        <Skeleton height={72} />
      </div>
    );
  }
  if (isError) {
    return <ErrorState body={t("versions.loadError")} onRetry={() => refetch()} />;
  }
  if (!versions || versions.length === 0) {
    return <div style={s.wrap}>{t("versions.empty")}</div>;
  }

  return (
    <div style={s.wrap}>
      {versions.map((v) => {
        const current = isCurrent(v.version, versions);
        const open = openDiff === v.version;
        return (
          <div key={v.version} style={s.entry}>
            <div style={s.row(current)}>
              <div style={s.main}>
                <div style={s.topRow}>
                  <span style={s.version}>{t("preview.version", { version: v.version })}</span>
                  {current && <Badge color="var(--accent)" bg="var(--accent-bg)">{t("versions.current")}</Badge>}
                  <span style={s.date}>{formatVersionDate(v.created_at)}</span>
                </div>
                <div style={s.note}>{v.note || t("versions.noNote")}</div>
              </div>
              <div style={s.actions}>
                {!current && (
                  <Button
                    kind="secondary"
                    size="sm"
                    icon="Eye"
                    onClick={() => setOpenDiff(open ? null : v.version)}
                  >
                    {open ? t("versions.hideDiff") : t("versions.diffVsCurrent")}
                  </Button>
                )}
                {!current && (
                  <Button
                    kind="secondary"
                    size="sm"
                    icon="History"
                    onClick={() => onRestore(v.version)}
                    disabled={restore.isPending}
                  >
                    {restore.isPending ? t("versions.restoring") : t("versions.restore")}
                  </Button>
                )}
              </div>
            </div>
            {open && !current && <VersionDiff version={v} versions={versions} />}
          </div>
        );
      })}
    </div>
  );
}

/** The diff of one (non-current) version against the current one: the chosen
 *  version is the "before" side, the current body the "after". Both sides are
 *  always real, so there is no initial-version special case here. */
function VersionDiff({ version, versions }: { version: SkillVersion; versions: SkillVersion[] }) {
  const t = useTranslations("skills");
  const after = currentVersion(versions);
  const lines = React.useMemo(() => diffLines(version.body, after?.body ?? ""), [version.body, after]);

  if (!after) return null;
  return (
    <div style={s.diffBox}>
      <div style={s.diffCaption}>
        {t("versions.diffVsCurrentTitle", { from: version.version, to: after.version })}
      </div>
      {isUnchanged(lines) ? (
        <div style={s.diffEmpty}>{t("versions.noChanges")}</div>
      ) : (
        <div className="mono" style={s.diffLines}>
          {lines.map((ln, i) => (
            <div key={i} style={lineRowFor(ln.kind)}>
              <span style={s.lineNo}>{ln.oldNo ?? ""}</span>
              <span style={s.lineNo}>{ln.newNo ?? ""}</span>
              <span style={lineSignFor(ln.kind)}>
                {ln.kind === "add" ? "+" : ln.kind === "del" ? "\u2212" : ""}
              </span>
              <span style={s.lineText}>{ln.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

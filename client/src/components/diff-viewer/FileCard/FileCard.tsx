/* FileCard — one collapsible file in the diff: header (path, severity dot,
   +/- stat, comment count) and, when open, its parsed lines plus any outdated
   comments and any findings outside the diff. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import { Icon, SEV } from "@devdigest/ui";
import type { PrFile } from "@/lib/types";
import { sortBySeverity } from "@/components/findings-preview";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { parsePatch, type Line } from "../helpers";
import {
  buildThreads,
  keysForLine,
  lineKey,
  partitionByLineKey,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
  type DiffFindingApi,
  cs,
} from "../comments";
import { s, chevronFor } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";

/** Stable empty-array reference — avoids a new `[]` on every render tripping
 *  the `findingsForFile` memo below. */
const EMPTY_FINDINGS: FindingRecord[] = [];

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

/** A finding anchors only to the new-file side — the side a review comments on. */
function findingsForLine(ln: Line, matched: Map<string, FindingRecord[]>): FindingRecord[] {
  if (matched.size === 0) return [];
  const key = lineKey("RIGHT", ln.newNo);
  return key ? (matched.get(key) ?? []) : [];
}

export function FileCard({
  file,
  commenting,
  findings,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  findings?: DiffFindingApi;
}) {
  const t = useTranslations("shell");
  // A file with non-dismissed findings must be open regardless of size — a
  // finding's card must appear under its line without toggling anything
  // (spec §Acceptance). `findings.byPath` is already the caller's
  // non-dismissed set (`latestFindingsPerAgent`), so no extra filter here.
  //
  // This can't be a `useState` initializer: findings often arrive AFTER this
  // card has already mounted (first load — `usePrReviews` resolves later
  // than the file list; post Run-review — the card is keyed by path, so it
  // never remounts). `userOpen` is `null` until the user actually clicks the
  // header; while it's `null`, `open` is derived fresh every render from the
  // current findings — no effect needed. An explicit user toggle (open OR
  // collapse) wins over a later-arriving finding.
  const hasFindings = (findings?.byPath.get(file.path)?.length ?? 0) > 0;
  const smallEnough = (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES;
  const [userOpen, setUserOpen] = React.useState<boolean | null>(null);
  const open = userOpen ?? (hasFindings || smallEnough);
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);

  const renderedKeys = React.useMemo(() => {
    const keys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) keys.add(k);
    return keys;
  }, [lines]);

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, renderedKeys]);

  const findingsForFile = React.useMemo(
    () => findings?.byPath.get(file.path) ?? EMPTY_FINDINGS,
    [findings, file.path],
  );
  const { matched: matchedFindings, unmatched: unmatchedFindings } = React.useMemo(() => {
    if (findingsForFile.length === 0) return { matched: new Map<string, FindingRecord[]>(), unmatched: [] };
    return partitionByLineKey(findingsForFile, (f) => lineKey("RIGHT", f.start_line), renderedKeys);
  }, [findingsForFile, renderedKeys]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;
  // The one-toggle-covers-both rule (spec decision 2) is resolved by the
  // caller into `findings.visible` — this component just reads it.
  const findingsVisible = findings?.visible ?? true;
  const worstFileSeverity =
    findingsForFile.length > 0 ? sortBySeverity(findingsForFile)[0]!.severity : null;

  return (
    <div style={s.fileCard}>
      <div onClick={() => setUserOpen(!open)} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        {findings && worstFileSeverity && (
          <span
            aria-label={findings.labels.fileDot(findingsForFile.length)}
            title={findings.labels.fileDot(findingsForFile.length)}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: SEV[worstFileSeverity].c,
              flexShrink: 0,
            }}
          />
        )}
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
      </div>
      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => (
              <CodeLine
                key={i}
                ln={ln}
                path={file.path}
                threads={threadsForLine(ln, matched)}
                commenting={commenting}
                findings={findingsForLine(ln, matchedFindings)}
                findingApi={findings}
              />
            ))
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
          {findings && findingsVisible && unmatchedFindings.length > 0 && (
            <div style={cs.outdatedWrap}>
              <div style={cs.outdatedTitle}>{findings.labels.outsideDiff(unmatchedFindings.length)}</div>
              {unmatchedFindings.map((f) => (
                <React.Fragment key={f.id}>{findings.renderFinding(f)}</React.Fragment>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

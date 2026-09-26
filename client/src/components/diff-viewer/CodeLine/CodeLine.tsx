/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, any anchored comment threads, any anchored findings,
   and an inline composer. */
"use client";

import React from "react";
import type { FindingRecord } from "@devdigest/shared";
import { SEV } from "@devdigest/ui";
import { sortBySeverity } from "@/components/findings-preview";
import {
  commentTargetFor,
  type CommentThread,
  type DiffCommentApi,
  type DiffFindingApi,
  cs,
} from "../comments";
import { type Line } from "../helpers";
import { s, lineRowFor, lineSignFor } from "../styles";
import { CommentThreadView } from "../CommentThreadView";
import { InlineComposer } from "../InlineComposer";

export function CodeLine({
  ln,
  path,
  threads,
  commenting,
  findings,
  findingApi,
}: {
  ln: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  findings: FindingRecord[];
  findingApi?: DiffFindingApi;
}) {
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(ln) : null;
  const showAdd = hover && !!target && !composing;
  // The one-toggle-covers-both rule (spec decision 2) is resolved by the
  // caller into `findingApi.visible` — this component just reads it.
  const findingsVisible = findingApi?.visible ?? true;
  const worstSeverity = findings.length > 0 ? sortBySeverity(findings)[0]!.severity : null;

  return (
    <div
      style={cs.rowWrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        style={
          worstSeverity
            ? { ...lineRowFor(ln.kind), boxShadow: `inset 3px 0 0 ${SEV[worstSeverity].c}` }
            : lineRowFor(ln.kind)
        }
      >
        <span className="mono tnum" style={{ ...s.lineNo, position: "relative" }}>
          {showAdd && target && (
            <button
              type="button"
              title="Add a comment on this line"
              aria-label="Add a comment on this line"
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            >
              +
            </button>
          )}
          {ln.newNo ?? ln.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(ln.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {ln.text || " "}
        </span>
        {worstSeverity && findingApi && (
          <span
            className="mono"
            style={{
              alignSelf: "center",
              flexShrink: 0,
              paddingRight: 10,
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: SEV[worstSeverity].c,
            }}
          >
            {findingApi.labels.sevTag(worstSeverity)}
          </span>
        )}
      </div>

      {commenting &&
        commenting.showComments &&
        threads.map((th) => (
          <CommentThreadView key={th.rootId} thread={th} commenting={commenting} path={path} />
        ))}

      {findingApi && findingsVisible && findings.length > 0 && (
        <div style={cs.thread}>
          {findings.map((f) => (
            <React.Fragment key={f.id}>{findingApi.renderFinding(f)}</React.Fragment>
          ))}
        </div>
      )}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}

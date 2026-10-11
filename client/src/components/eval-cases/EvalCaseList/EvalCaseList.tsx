/* EvalCaseList — the rows of an owner's eval cases, shared by the agent and skill Evals tabs
   (the same row content in both, AC-14). Each row: name, an origin badge ("from finding" /
   "manual"), `expectation · file:line`, the SUITE result as the main badge, and — only when a
   single-case run is newer than that suite result — a secondary text marker beside it, so the
   suite result stays the row's main result (AC-13). Run / Edit / Delete are callbacks; the tab
   decides what they do. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, IconBtn } from "@devdigest/ui";
import type { EvalCaseListItem } from "@devdigest/shared";
import { EXPECTATION_KEY, ORIGIN_KEY, RESULT_COLOR, RESULT_KEY, targetLabel } from "../helpers";
import { s } from "./styles";

export function EvalCaseList({
  cases,
  onEdit,
  onRun,
  onDelete,
  runBlockedReason,
  runningCaseId,
}: {
  cases: EvalCaseListItem[];
  onEdit: (c: EvalCaseListItem) => void;
  onRun: (c: EvalCaseListItem) => void;
  onDelete: (c: EvalCaseListItem) => void;
  /** Why Run is unavailable for every row (EC-10); shown as the button's title. */
  runBlockedReason?: string | null;
  /** The case whose single run is in flight: its Run is disabled. */
  runningCaseId?: string | null;
}) {
  const t = useTranslations("eval");
  return (
    <div style={s.list}>
      {cases.map((c) => (
        <div key={c.id} style={s.row}>
          <div style={s.rowMain}>
            <div style={s.nameLine}>
              <span style={s.name}>{c.name}</span>
              <Badge>{t(ORIGIN_KEY[c.source])}</Badge>
            </div>
            <span className="mono" style={s.meta}>
              {t(EXPECTATION_KEY[c.expectation])} · {targetLabel(c.target)}
            </span>
          </div>
          <div style={s.results}>
            <Badge color={RESULT_COLOR[c.last_result]}>{t(RESULT_KEY[c.last_result])}</Badge>
            {c.latest_single && (
              <span style={s.marker}>
                {t("evalsTab.singleMarker", { result: t(RESULT_KEY[c.latest_single.status]) })}
              </span>
            )}
          </div>
          {runBlockedReason || runningCaseId === c.id ? (
            // IconBtn has no disabled state: the wrapper carries it, and no handler is attached.
            <span title={runBlockedReason ?? undefined} aria-disabled="true" style={s.disabled}>
              <IconBtn icon="Play" label={t("evalsTab.runAria", { name: c.name })} />
            </span>
          ) : (
            <IconBtn icon="Play" label={t("evalsTab.runAria", { name: c.name })} onClick={() => onRun(c)} />
          )}
          <IconBtn icon="Edit" label={t("evalsTab.editAria", { name: c.name })} onClick={() => onEdit(c)} />
          <IconBtn
            icon="Trash"
            label={t("evalsTab.deleteAria", { name: c.name })}
            danger
            onClick={() => onDelete(c)}
          />
        </div>
      ))}
    </div>
  );
}

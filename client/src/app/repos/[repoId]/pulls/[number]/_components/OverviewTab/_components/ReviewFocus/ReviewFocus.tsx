/* ReviewFocus — "Review focus — read these first": the brief's ordered list of
   places to start reading. Each row jumps to `file:line` in Files changed. The
   whole card is hidden when the brief has no focus items. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, SectionLabel } from "@devdigest/ui";
import type { BriefReviewFocusItem } from "@devdigest/shared";
import { s } from "./styles";

export function ReviewFocus({
  items,
  onJump,
}: {
  items: BriefReviewFocusItem[];
  onJump: (ref: string) => void;
}) {
  const t = useTranslations("brief");
  if (items.length === 0) return null;

  return (
    <section>
      <SectionLabel icon="ListChecks" right={<Badge>{items.length}</Badge>}>
        {t("reviewFocus.title")}
      </SectionLabel>
      <div style={s.card}>
        <ol style={s.list}>
          {items.map((item, i) => {
            const target = `${item.file}:${item.line}`;
            return (
              <li key={i}>
                <button
                  type="button"
                  style={s.rowBtn}
                  title={t("reviewFocus.open", { target })}
                  onClick={() => onJump(target)}
                >
                  <span className="mono" style={s.target}>
                    {target}
                  </span>
                  {" — "}
                  {item.reason}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

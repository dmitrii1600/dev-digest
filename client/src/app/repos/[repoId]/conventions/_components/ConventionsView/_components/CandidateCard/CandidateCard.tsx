/* CandidateCard — one convention candidate: rule, category badge, `file:line`
   evidence with the snippet, confidence, and Accept / Reject / Edit. Edit is
   inline (criterion 49): the rule and category become inputs, evidence stays
   read-only because it is what grounds the rule. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ConfidenceNum, IconBtn, ProgressBar, SelectInput, Textarea } from "@devdigest/ui";
import type { ConventionCandidate, ConventionCategory, ConventionStatus } from "@devdigest/shared";
import { CONVENTION_CATEGORY_COLOR, SKILL_TYPE_COLOR_FALLBACK } from "@/lib/skill-tokens";
import { CATEGORIES } from "./constants";
import { s } from "./styles";

export interface CandidatePatch {
  status?: ConventionStatus;
  rule?: string;
  category?: ConventionCategory;
}

export function CandidateCard({
  candidate,
  busy,
  onPatch,
}: {
  candidate: ConventionCandidate;
  busy?: boolean;
  onPatch: (patch: CandidatePatch) => void;
}) {
  const t = useTranslations("conventions");
  const [editing, setEditing] = React.useState(false);
  const [rule, setRule] = React.useState(candidate.rule);
  const [category, setCategory] = React.useState<ConventionCategory>(candidate.category);
  const color = CONVENTION_CATEGORY_COLOR[candidate.category] ?? SKILL_TYPE_COLOR_FALLBACK;
  const accepted = candidate.status === "accepted";
  const pct = Math.round(candidate.confidence * 100);
  const where = candidate.evidence_line
    ? `${candidate.evidence_path}:${candidate.evidence_line}`
    : candidate.evidence_path;

  const startEdit = () => {
    setRule(candidate.rule);
    setCategory(candidate.category);
    setEditing(true);
  };
  const cancelEdit = () => setEditing(false);
  const save = () => {
    const patch: CandidatePatch = {};
    if (rule.trim() && rule.trim() !== candidate.rule) patch.rule = rule.trim();
    if (category !== candidate.category) patch.category = category;
    if (Object.keys(patch).length > 0) onPatch(patch);
    setEditing(false);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") cancelEdit();
  };

  return (
    <div style={s.card(accepted)} data-testid={`candidate-${candidate.id}`} onKeyDown={onKeyDown}>
      <div style={s.main}>
        {editing ? (
          <div style={s.editRow}>
            <span style={s.fieldLabel}>{t("card.ruleLabel")}</span>
            <Textarea value={rule} onChange={setRule} rows={2} />
            <span style={s.fieldLabel}>{t("card.categoryLabel")}</span>
            <SelectInput
              value={category}
              onChange={(v) => setCategory(v as ConventionCategory)}
              options={CATEGORIES.map((c) => ({ value: c, label: t(`card.category.${c}`) }))}
            />
          </div>
        ) : (
          <div style={s.titleRow}>
            <span style={s.rule}>{candidate.rule}</span>
            <Badge color={color} bg={color + "1a"}>
              {t(`card.category.${candidate.category}`)}
            </Badge>
            {candidate.edited && <Badge color="var(--text-muted)">{t("card.edited")}</Badge>}
            {candidate.skill_id && (
              <Badge color="var(--accent)" bg="var(--accent-bg)" icon="Sparkles">
                {t("card.inSkill")}
              </Badge>
            )}
          </div>
        )}

        <div style={s.evidence}>
          <div style={s.evidenceHead}>
            <span className="mono" style={s.evidencePath}>
              {where}
            </span>
            <IconBtn
              icon="Copy"
              label={t("card.copyPath")}
              size={13}
              onClick={() => void navigator.clipboard?.writeText(where)}
            />
          </div>
          <pre className="mono" style={s.snippet}>
            {candidate.evidence_snippet}
          </pre>
        </div>

        <div style={s.confidenceRow}>
          <span>{t("card.confidence")}</span>
          <div style={s.confidenceBar}>
            <ProgressBar value={pct} color={pct >= 85 ? "var(--ok)" : pct >= 65 ? "var(--warn)" : "var(--text-muted)"} />
          </div>
          <ConfidenceNum value={candidate.confidence} />
        </div>
      </div>

      <div style={s.actions}>
        {editing ? (
          <>
            <Button kind="primary" size="sm" icon="Check" onClick={save} disabled={busy || !rule.trim()}>
              {t("card.save")}
            </Button>
            <Button kind="ghost" size="sm" icon="X" onClick={cancelEdit}>
              {t("card.cancel")}
            </Button>
          </>
        ) : (
          <>
            <Button
              kind={accepted ? "primary" : "secondary"}
              size="sm"
              icon="Check"
              active={accepted}
              disabled={busy}
              onClick={() => onPatch({ status: accepted ? "pending" : "accepted" })}
            >
              {accepted ? t("card.accepted") : t("card.accept")}
            </Button>
            <Button
              kind="secondary"
              size="sm"
              icon="X"
              disabled={busy}
              onClick={() => onPatch({ status: "rejected" })}
            >
              {t("card.reject")}
            </Button>
            <Button kind="ghost" size="sm" icon="Edit" disabled={busy} onClick={startEdit}>
              {t("card.edit")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

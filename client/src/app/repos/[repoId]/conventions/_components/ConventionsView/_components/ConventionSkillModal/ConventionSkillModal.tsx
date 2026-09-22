/* ConventionSkillModal — "Create skill from conventions" (criteria 41, 51).
   Opens on the server's draft (accepted, unabsorbed candidates rendered as a
   skill body), everything editable: name, description, type, enabled, the
   agents to bind, and the body itself. Same form idiom as ConfigTab: one
   useState per field, no form library; validation is the server's. Binding
   to an agent is optional (2026-09-20): nothing is preselected and the skill
   may land unbound in Skills Lab, to be attached later from an agent's
   Skills tab. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Checkbox,
  FormField,
  Icon,
  Modal,
  SelectInput,
  Skeleton,
  Textarea,
  TextInput,
  Toggle,
} from "@devdigest/ui";
import type { ConventionSkillDraft, SkillType } from "@devdigest/shared";
import { useAgents } from "@/lib/hooks/agents";
import { useCreateConventionSkill, usePreviewConventionSkill } from "@/lib/hooks/conventions";
import { useToast } from "@/providers/toast";
import { MODAL_WIDTH } from "../../constants";
import { BODY_ROWS, SKILL_TYPES } from "./constants";
import { estimateTokens } from "./helpers";
import { s } from "./styles";

export function ConventionSkillModal({
  repoId,
  repoName,
  candidateCount,
  onClose,
}: {
  repoId: string;
  repoName: string;
  candidateCount: number;
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const router = useRouter();
  const toast = useToast();
  const preview = usePreviewConventionSkill(repoId);
  const create = useCreateConventionSkill(repoId);
  const { data: agents } = useAgents();

  const [draft, setDraft] = React.useState<ConventionSkillDraft | null>(null);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("convention");
  const [enabled, setEnabled] = React.useState(true);
  const [body, setBody] = React.useState("");
  // Nothing preselected — binding is opt-in.
  const [chosen, setAgentIds] = React.useState<string[]>([]);

  // One preview per open — the modal is modal, so the accepted set cannot
  // change underneath it.
  const { mutateAsync: fetchDraft } = preview;
  React.useEffect(() => {
    let cancelled = false;
    fetchDraft(undefined).then((d) => {
      if (cancelled) return;
      setDraft(d);
      setName(d.name);
      setDescription(d.description);
      setType(d.type);
      setBody(d.body);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchDraft]);

  const toggleAgent = (id: string, on: boolean) =>
    setAgentIds(on ? [...chosen, id] : chosen.filter((a) => a !== id));

  const canCreate = !!draft && name.trim().length > 0 && body.trim().length > 0 && !create.isPending;

  const submit = () => {
    if (!canCreate || !draft) return;
    create.mutate(
      {
        candidate_ids: draft.candidate_ids,
        name: name.trim(),
        description: description.trim(),
        type,
        body,
        enabled,
        agent_ids: chosen,
      },
      {
        onSuccess: ({ skill_id }) => {
          toast.success(t("skill.created", { name: name.trim() }));
          onClose();
          router.push(`/skills/${skill_id}?tab=preview`);
        },
      },
    );
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("modal.title")}
      subtitle={<span className="mono">{name || draft?.name || ""}</span>}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <span style={s.footerNote}>
            <Icon.GitCommit size={13} />
            {t.rich("modal.savedAs", { code: (c) => <code className="mono">{c}</code> })}
          </span>
          <Button kind="ghost" onClick={onClose}>
            {t("modal.cancel")}
          </Button>
          <Button kind="primary" icon="Sparkles" onClick={submit} disabled={!canCreate}>
            {create.isPending ? t("modal.creating") : t("modal.create")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.banner}>
          <Icon.GitBranch size={15} style={s.bannerIcon} />
          <span>
            {t.rich("modal.banner", {
              count: candidateCount,
              repo: repoName,
              b: (c) => <b>{c}</b>,
              code: (c) => <code className="mono">{c}</code>,
            })}
          </span>
        </div>

        <FormField label={t("modal.name")} required>
          <TextInput value={name} onChange={setName} mono />
        </FormField>
        <FormField label={t("modal.description")}>
          <TextInput value={description} onChange={setDescription} />
        </FormField>

        <div style={s.twoCol}>
          <FormField label={t("modal.type")}>
            <SelectInput
              value={type}
              onChange={(v) => setType(v as SkillType)}
              options={SKILL_TYPES.map((v) => ({ value: v, label: t(`modal.skillType.${v}`) }))}
            />
          </FormField>
          <FormField label={t("modal.enabled")} hint={t("modal.enabledHint")}>
            <Toggle on={enabled} onChange={setEnabled} />
          </FormField>
        </div>

        <FormField
          label={t("modal.agents")}
          hint={chosen.length === 0 ? <span style={s.hint}>{t("modal.agentsOptional")}</span> : t("modal.agentsHint")}
        >
          <div style={s.agents}>
            {(agents ?? []).map((a) => (
              <label key={a.id} style={s.agentRow}>
                <Checkbox checked={chosen.includes(a.id)} onChange={(on) => toggleAgent(a.id, on)} label={a.name} />
                <span className="mono" style={s.agentModel}>
                  {a.model}
                </span>
              </label>
            ))}
          </div>
        </FormField>

        <FormField label={t("modal.body")} required>
          <div style={s.bodyHead}>
            <Icon.FileText size={13} />
            <span className="mono">{`${name.trim() || draft?.name || "skill"}.md`}</span>
            <Badge color="var(--warn)" bg="var(--warn-bg)">
              {t("modal.unsaved")}
            </Badge>
            <span style={s.bodyHeadSpacer} />
            <span className="mono tnum">{t("modal.tokens", { count: estimateTokens(body) })}</span>
          </div>
          {draft ? (
            <Textarea value={body} onChange={setBody} rows={BODY_ROWS} mono />
          ) : (
            <Skeleton height={220} />
          )}
        </FormField>
      </div>
    </Modal>
  );
}

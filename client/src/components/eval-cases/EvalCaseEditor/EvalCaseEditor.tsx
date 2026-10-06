/* EvalCaseEditor — write or edit one eval case by hand (agent- or skill-owned). Left: name and a
   Diff / Files / PR meta tabbed input; right: the expectation as form fields AND as JSON, kept in
   sync in both directions, plus the last run of the case. The form fields are the source of truth;
   the JSON text is derived from them until the user types in the JSON box, and a JSON edit that
   does not fit the shape leaves the fields at their last valid values (EC-4). Nothing here calls
   the model except "Run case" / "Run on save", which hand the saved case id to the tab (`onRun`)
   — the tab decides how a run starts (an agent case runs directly, a skill case needs a host). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Modal, SelectInput, Tabs, TextInput, Textarea, Toggle } from "@devdigest/ui";
import type { EvalCase, EvalCaseRunState } from "@devdigest/shared";
import { ConfirmModal } from "@/components/confirm-modal";
import { DiffViewer } from "@/components/diff-viewer";
import { formatCost } from "@/components/eval-metrics";
import { useCreateEvalCase, useEvalCaseRunState, useUpdateEvalCase } from "@/lib/hooks/evals";
import { formatRanges, parsePastedDiff, type PastedDiff } from "../case-diff";
import { formatExpectationJson, parseExpectationJson } from "../expectation-json";
import { EXPECTATION_KEY, targetLabel } from "../helpers";
import {
  EMPTY_DRAFT,
  JSON_ERROR_KEY,
  draftErrors,
  draftFromCase,
  inputFromDraft,
  sameDraft,
  targetChanged,
  type Draft,
  type DraftError,
} from "./helpers";
import { s } from "./styles";

const TAB_KEYS = ["diff", "files", "meta"] as const;
type TabKey = (typeof TAB_KEYS)[number];

const TAB_LABEL: Record<TabKey, string> = {
  diff: "caseEditor.tabs.diff",
  files: "caseEditor.tabs.files",
  meta: "caseEditor.tabs.prMeta",
};

export interface EvalCaseEditorProps {
  owner: { kind: "agent" | "skill"; id: string };
  /** The case being edited; absent for a new one. */
  initial?: EvalCase;
  /** Names of the OTHER cases in the owner's set. */
  takenNames: string[];
  onClose: () => void;
  /** Start a single-case run of this saved case. The tab owns how (host picker for a skill). */
  onRun: (caseId: string) => void;
  /** Why "Run case" is unavailable for reasons outside the editor (EC-10). */
  runBlockedReason?: string | null;
}

function Field({ label, error, children }: { label: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div style={s.field}>
      <label style={s.field}>
        <span style={s.label}>{label}</span>
        {children}
      </label>
      {error && <span style={s.error}>{error}</span>}
    </div>
  );
}

function LastRun({ state }: { state: EvalCaseRunState | undefined }) {
  const t = useTranslations("eval");
  const latest = state?.latest ?? null;
  return (
    <div style={s.lastRun} aria-live="polite">
      <div style={s.lastRunTitle}>{t("caseEditor.lastRun.title")}</div>
      {state?.running ? (
        <div>{t("caseEditor.lastRun.running")}</div>
      ) : latest ? (
        <>
          <div>
            {t(latest.run.kind === "single" ? "caseEditor.lastRun.kindSingle" : "caseEditor.lastRun.kindSuite")}
            {" · "}
            {t("caseEditor.lastRun.agentVersion", { version: latest.run.agent_version })}
            {" · "}
            <strong>{t(`caseEditor.lastRun.${latest.result.status}`)}</strong>
          </div>
          <div>
            {t(
              latest.result.expectation === "must_find"
                ? "caseEditor.lastRun.expectedMustFind"
                : "caseEditor.lastRun.expectedMustNotFlag",
              { target: targetLabel(latest.result.target) },
            )}
          </div>
          <div>
            {t("caseEditor.lastRun.got", { count: latest.result.findings.length, matched: latest.result.matched })}
          </div>
          <div className="mono">
            {t("caseEditor.lastRun.duration", { seconds: ((latest.result.duration_ms ?? 0) / 1000).toFixed(1) })}
            {" · "}
            {t("caseEditor.lastRun.cost", { cost: formatCost(latest.result.cost_usd) })}
          </div>
          {latest.result.status === "errored" && latest.result.error && (
            <div style={s.error}>{t("caseEditor.lastRun.error", { reason: latest.result.error })}</div>
          )}
        </>
      ) : (
        <div style={s.hint}>{t("caseEditor.lastRun.none")}</div>
      )}
    </div>
  );
}

function FilesView({ parsed }: { parsed: PastedDiff }) {
  const t = useTranslations("eval");
  return (
    <div style={s.files}>
      <div style={s.hint}>{t("caseEditor.filesHint")}</div>
      {parsed.ok ? (
        <ul style={{ ...s.files, listStyle: "none", margin: 0, padding: 0 }}>
          {parsed.files.map((f) => (
            <li key={f.path} style={s.fileRow}>
              <span className="mono">{f.path}</span>
              <span style={s.hint}>{t("caseEditor.changedLines", { ranges: formatRanges(f.ranges) })}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div style={s.hint}>{t("caseEditor.filesEmpty")}</div>
      )}
    </div>
  );
}

export function EvalCaseEditor({ owner, initial, takenNames, onClose, onRun, runBlockedReason }: EvalCaseEditorProps) {
  const t = useTranslations("eval");
  const create = useCreateEvalCase(owner);
  const update = useUpdateEvalCase();

  // What is saved: the id (null until the first save), its origin, and the values it holds.
  const [saved, setSaved] = React.useState({
    id: initial?.id ?? null,
    source: initial?.source ?? "manual",
    draft: initial ? draftFromCase(initial) : EMPTY_DRAFT,
  });
  const [draft, setDraft] = React.useState<Draft>(saved.draft);
  // The JSON box's own text while the user types in it; null = show the text derived from the fields.
  const [jsonText, setJsonText] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<TabKey>("diff");
  const [runOnSave, setRunOnSave] = React.useState(false);
  const [confirmClose, setConfirmClose] = React.useState(false);
  const { data: runState } = useEvalCaseRunState(saved.id);

  const dirty = !sameDraft(draft, saved.draft);
  const parsed = React.useMemo(() => parsePastedDiff(draft.diff), [draft.diff]);
  const createdHere = !initial && saved.id !== null;
  const errors = draftErrors(draft, parsed, takenNames, createdHere ? saved.draft.name : undefined);
  const errorFor = (field: DraftError["field"]): string | null => {
    const e = errors.find((x) => x.field === field);
    return e ? t(`caseEditor.${e.key}`, e.values) : null;
  };

  const derivedJson = formatExpectationJson({
    type: draft.expectation,
    file: draft.file,
    start_line: Number(draft.start),
    end_line: Number(draft.end),
  });
  const jsonValue = jsonText ?? derivedJson;
  const jsonCheck = parseExpectationJson(jsonValue);

  const saving = create.isPending || update.isPending;
  const saveError = create.isError ? create.error : update.isError ? update.error : null;
  const canSave = dirty && errors.length === 0 && jsonCheck.ok && !saving;
  const unsaved = saved.id === null || dirty;
  const showOriginWarning = saved.source === "finding" && targetChanged(draft, saved.draft);

  // A form edit hands the JSON box back to the fields.
  const edit = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setJsonText(null);
  };
  const editJson = (text: string) => {
    setJsonText(text);
    const r = parseExpectationJson(text);
    if (r.ok) {
      setDraft((d) => ({
        ...d,
        expectation: r.value.type,
        file: r.value.file,
        start: String(r.value.start_line),
        end: String(r.value.end_line),
      }));
    }
  };
  const skeleton = () => {
    const first = parsed.ok ? parsed.files[0] : undefined;
    if (!first) return;
    const range = first.ranges[0];
    edit({ file: first.path, ...(range ? { start: String(range[0]), end: String(range[1]) } : {}) });
  };

  const requestClose = () => (dirty ? setConfirmClose(true) : onClose());

  // Escape goes through the same guard as the X, the backdrop and Cancel (EC-6).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirmClose) setConfirmClose(false);
      else if (dirty) setConfirmClose(true);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmClose, dirty, onClose]);

  const save = () => {
    const input = inputFromDraft(draft);
    const done = (c: EvalCase) => {
      setSaved({ id: c.id, source: c.source, draft });
      setJsonText(null);
      if (runOnSave) onRun(c.id);
    };
    if (saved.id) update.mutate({ caseId: saved.id, input }, { onSuccess: done });
    else create.mutate(input, { onSuccess: done });
  };

  const jsonReason = jsonCheck.ok ? null : t(`caseEditor.${JSON_ERROR_KEY[jsonCheck.reason]}`);
  const fileOptions = [
    { value: "", label: t("caseEditor.filePlaceholder") },
    ...(parsed.ok ? parsed.files.map((f) => ({ value: f.path, label: f.path })) : []),
  ];
  const runHint = unsaved ? t("caseEditor.runNeedsSave") : (runBlockedReason ?? null);
  const runDisabled = !!runHint || !!runState?.running;
  const tabs = TAB_KEYS.map((k) => ({ key: k, label: t(TAB_LABEL[k]) }));

  return (
    <>
      <Modal
        width={920}
        title={saved.id ? t("caseEditor.caseTitle", { name: saved.draft.name }) : t("caseEditor.newCase")}
        onClose={requestClose}
        footer={
          <div style={s.footer}>
            <label style={s.toggle}>
              {t("caseEditor.runOnSave")}
              <Toggle on={runOnSave} onChange={setRunOnSave} />
            </label>
            {runHint && <span style={s.runHint}>{runHint}</span>}
            <div style={s.spacer}>
              <Button kind="ghost" onClick={requestClose}>
                {t("caseEditor.cancel")}
              </Button>
              <Button
                kind="secondary"
                icon="Play"
                disabled={runDisabled}
                onClick={() => saved.id && onRun(saved.id)}
              >
                {runState?.running ? t("caseEditor.running") : t("caseEditor.runCase")}
              </Button>
              <Button kind="primary" disabled={!canSave} loading={saving} onClick={save}>
                {saving ? t("caseEditor.saving") : t("caseEditor.save")}
              </Button>
            </div>
          </div>
        }
      >
        <div style={s.grid}>
          <div style={s.left}>
            <Field label={t("caseEditor.nameLabel")} error={errorFor("name")}>
              <TextInput
                value={draft.name}
                onChange={(v) => edit({ name: v })}
                placeholder={t("caseEditor.namePlaceholder")}
              />
            </Field>
            <Tabs tabs={tabs} value={tab} onChange={(k) => setTab(k as TabKey)} pad="0" />
            {tab === "diff" && (
              <>
                <Field label={t("caseEditor.tabs.diff")} error={errorFor("diff")}>
                  <Textarea
                    mono
                    rows={9}
                    value={draft.diff}
                    onChange={(v) => edit({ diff: v })}
                    placeholder={t("caseEditor.diffPlaceholder")}
                  />
                </Field>
                {parsed.ok && (
                  <div style={s.preview}>
                    <div style={s.label}>{t("caseEditor.preview")}</div>
                    <DiffViewer files={parsed.files} />
                  </div>
                )}
              </>
            )}
            {tab === "files" && <FilesView parsed={parsed} />}
            {tab === "meta" && (
              <>
                <Field label={t("caseEditor.titleLabel")} error={errorFor("title")}>
                  <TextInput
                    value={draft.title}
                    onChange={(v) => edit({ title: v })}
                    placeholder={t("caseEditor.titlePlaceholder")}
                  />
                </Field>
                <Field label={t("caseEditor.bodyLabel")} error={errorFor("body")}>
                  <Textarea
                    rows={5}
                    value={draft.body}
                    onChange={(v) => edit({ body: v })}
                    placeholder={t("caseEditor.bodyPlaceholder")}
                  />
                </Field>
              </>
            )}
          </div>

          <div style={s.right}>
            <Field label={t("caseEditor.expectationLabel")}>
              <SelectInput
                mono={false}
                value={draft.expectation}
                onChange={(v) => edit({ expectation: v as Draft["expectation"] })}
                options={(Object.keys(EXPECTATION_KEY) as Draft["expectation"][]).map((k) => ({
                  value: k,
                  label: t(EXPECTATION_KEY[k]),
                }))}
              />
            </Field>
            <Field label={t("caseEditor.fileLabel")}>
              <SelectInput value={draft.file} onChange={(v) => edit({ file: v })} options={fileOptions} />
            </Field>
            <div style={s.row}>
              <div style={s.grow}>
                <TextInput
                  type="number"
                  aria-label={t("caseEditor.startLineLabel")}
                  value={draft.start}
                  onChange={(v) => edit({ start: v })}
                />
              </div>
              <div style={s.grow}>
                <TextInput
                  type="number"
                  aria-label={t("caseEditor.endLineLabel")}
                  value={draft.end}
                  onChange={(v) => edit({ end: v })}
                />
              </div>
              <Button kind="secondary" size="sm" disabled={!parsed.ok} onClick={skeleton}>
                {t("caseEditor.findingSkeleton")}
              </Button>
            </div>
            {errorFor("target") && <div style={s.error}>{errorFor("target")}</div>}
            {showOriginWarning && <div style={s.warning}>{t("caseEditor.originWarning")}</div>}

            <Field label={t("caseEditor.expectedOutput")}>
              <Textarea mono rows={7} value={jsonValue} onChange={editJson} />
            </Field>
            <div style={s.jsonHead}>
              <Badge color={jsonCheck.ok ? "var(--ok)" : "var(--crit)"}>
                {jsonCheck.ok ? t("caseEditor.validJson") : t("caseEditor.invalidJson")}
              </Badge>
              {jsonReason && <span style={s.error}>{jsonReason}</span>}
            </div>

            <LastRun state={runState} />
            {saveError && (
              <div role="alert" style={s.error}>
                {saveError.message}
              </div>
            )}
          </div>
        </div>
      </Modal>
      {confirmClose && (
        <ConfirmModal
          title={t("caseEditor.discardTitle")}
          body={t("caseEditor.discardBody")}
          confirmLabel={t("caseEditor.discardConfirm")}
          cancelLabel={t("caseEditor.keepEditing")}
          onCancel={() => setConfirmClose(false)}
          onConfirm={onClose}
        />
      )}
    </>
  );
}

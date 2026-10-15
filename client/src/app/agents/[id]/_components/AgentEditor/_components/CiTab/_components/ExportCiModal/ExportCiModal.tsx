/* ExportCiModal — the 4-step Export to CI wizard (Target → Preview → Configure
   → Install). The only dialog; every choice lives here so Back/Continue keep it.
   The Preview shows exactly the files the server will write, and the workflow is
   the only editable one (sent verbatim when edited). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ExportWizardSteps, Modal } from "@devdigest/ui";
import type { Agent, CiExport, CiPostAs, CiTrigger } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useRepos } from "@/lib/hooks/core";
import { useCiPreview, useExportCi } from "@/lib/hooks/ci";
import { downloadZip, validateWorkflow, zipFileName } from "./helpers";
import { ConfigureStep } from "./_components/ConfigureStep";
import { PreviewStep } from "./_components/PreviewStep";
import { TargetStep } from "./_components/TargetStep";
import { s } from "./styles";

type Action = "open_pr" | "files";
const STEP_KEYS = ["target", "preview", "configure", "install"] as const;
const GITHUB_ERROR_CODES = new Set(["ci_github_failed", "config_error"]);

export function ExportCiModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const t = useTranslations("ci");
  const { data: repoRows } = useRepos();
  const repos = React.useMemo(() => (repoRows ?? []).map((r) => r.full_name), [repoRows]);

  const [step, setStep] = React.useState(0);
  const [chosenRepo, setChosenRepo] = React.useState<string | null>(null);
  const [triggers, setTriggers] = React.useState<CiTrigger[]>(["opened", "synchronize"]);
  const [postAs, setPostAs] = React.useState<CiPostAs>("github_review");
  const [edited, setEdited] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<Action>("open_pr");
  const [done, setDone] = React.useState<{ action: Action; data: CiExport } | null>(null);
  const [error, setError] = React.useState<{ code?: string; message: string } | null>(null);

  const repo = chosenRepo ?? repos[0] ?? "";
  const exportCi = useExportCi(agent.id);
  const preview = useCiPreview(agent.id, { repo, triggers, postAs }, step >= 1);

  const generated = preview.data?.files.find((f) => f.editable)?.contents ?? "";
  const workflowText = edited ?? generated;
  const check = validateWorkflow(workflowText);
  const bundleMissing = preview.data?.bundle_missing === true;
  const previewReady = !!preview.data && !bundleMissing && check.ok;

  const canContinue =
    (step === 0 && repos.length > 0 && !!repo) ||
    (step === 1 && previewReady) ||
    (step === 2 && triggers.length > 0);

  const submit = (action: Action) => {
    setError(null);
    exportCi.mutate(
      { repo, action, post_as: postAs, triggers, workflow_yaml: edited ?? undefined },
      {
        onSuccess: (data) => {
          setDone({ action, data });
          if (action === "files" && data.zip_base64) downloadZip(data.zip_base64, zipFileName(repo));
        },
        onError: (e) =>
          setError({ code: e instanceof ApiError ? e.code : undefined, message: e instanceof Error ? e.message : String(e) }),
      },
    );
  };

  const footer = done ? (
    <div style={s.footer}>
      <Button kind="primary" onClick={onClose}>
        {t("wizard.install.close")}
      </Button>
    </div>
  ) : (
    <div style={s.footer}>
      {step > 0 && (
        <Button kind="ghost" onClick={() => setStep(step - 1)} disabled={exportCi.isPending}>
          {t("wizard.back")}
        </Button>
      )}
      {step < 3 ? (
        <Button kind="primary" onClick={() => setStep(step + 1)} disabled={!canContinue}>
          {t("wizard.continue")}
        </Button>
      ) : (
        <Button kind="primary" onClick={() => submit(mode)} disabled={!previewReady || exportCi.isPending}>
          {exportCi.isPending ? t("wizard.installing") : t("wizard.installButton")}
        </Button>
      )}
    </div>
  );

  return (
    <Modal width={820} title={t("wizard.title")} subtitle={agent.name} onClose={onClose} footer={footer}>
      <div style={s.body}>
        <ExportWizardSteps step={step} labels={STEP_KEYS.map((k) => t(`wizard.steps.${k}`))} />
        {step === 0 && <TargetStep repos={repos} repo={repo} onRepo={setChosenRepo} />}
        {step === 1 && (
          <PreviewStep
            preview={preview.data}
            loading={preview.isLoading}
            workflowText={workflowText}
            check={check}
            onEdit={setEdited}
          />
        )}
        {step === 2 && (
          <ConfigureStep
            triggers={triggers}
            onTriggers={setTriggers}
            postAs={postAs}
            onPostAs={setPostAs}
            edited={edited !== null}
          />
        )}
        {step === 3 && !done && (
          <div style={s.group}>
            {(["open_pr", "files"] as const).map((m) => (
              <label key={m} style={s.row}>
                <input type="radio" name="ci-install-mode" checked={mode === m} onChange={() => setMode(m)} />
                <span>
                  <strong>{t(m === "open_pr" ? "wizard.install.openPr" : "wizard.install.zip")}</strong>
                  <br />
                  <span style={s.cardDesc}>
                    {m === "open_pr" ? t("wizard.install.openPrDesc", { repo }) : t("wizard.install.zipDesc")}
                  </span>
                </span>
              </label>
            ))}
            {error && (
              <div role="alert" style={s.group}>
                <p style={s.error}>
                  {error.code && GITHUB_ERROR_CODES.has(error.code)
                    ? t("wizard.install.githubError", { message: error.message })
                    : error.message}
                </p>
                {error.code && GITHUB_ERROR_CODES.has(error.code) && (
                  <Button kind="secondary" onClick={() => submit("files")} disabled={exportCi.isPending}>
                    {t("wizard.install.zipInstead")}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
        {step === 3 && done && (
          <div style={s.group} role="status">
            {done.action === "open_pr" ? (
              <>
                <strong>{t("wizard.install.prDone")}</strong>
                {done.data.pr_url && (
                  <a href={done.data.pr_url} target="_blank" rel="noopener noreferrer" style={s.link}>
                    {t("wizard.install.viewPr")}
                  </a>
                )}
              </>
            ) : (
              <strong>{t("wizard.install.zipDone", { repo })}</strong>
            )}
            <span style={s.sectionLabel}>{t("wizard.install.nextSteps")}</span>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              <li>{t("wizard.install.step1")}</li>
              <li>{t("wizard.install.step2")}</li>
              <li>{t("wizard.install.step3")}</li>
            </ol>
          </div>
        )}
      </div>
    </Modal>
  );
}

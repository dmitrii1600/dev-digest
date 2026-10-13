import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import messages from "../../../../../../../../../../messages/en/ci.json";

const WORKFLOW = "name: DevDigest Review\non:\n  pull_request:\n    types: [opened]\n";
const baseFiles = [
  { path: ".devdigest/agents/sec.yaml", contents: "name: Sec\n", editable: false },
  { path: ".devdigest/skills/a.md", contents: "skill", editable: false },
  { path: ".devdigest/memory.jsonl", contents: "", editable: false },
  { path: ".devdigest/runner/index.js", contents: "//", editable: false },
  { path: ".github/workflows/devdigest-review.yml", contents: WORKFLOW, editable: true },
];
let repos: { full_name: string }[] = [{ full_name: "o/a" }, { full_name: "o/b" }];
let preview: unknown = { files: baseFiles, skipped_skills: [], bundle_missing: false };
const mutate = vi.fn();

vi.mock("@/lib/hooks/core", () => ({ useRepos: () => ({ data: repos }) }));
vi.mock("@/lib/hooks/ci", () => ({
  useCiPreview: () => ({ data: preview, isLoading: false }),
  useExportCi: () => ({ mutate, isPending: false }),
}));
const { downloadZip } = vi.hoisted(() => ({ downloadZip: vi.fn() }));
vi.mock("./helpers", async (orig) => ({ ...(await orig<typeof import("./helpers")>()), downloadZip }));

import { ExportCiModal } from "./ExportCiModal";

const agent = { id: "a1", name: "Sec" } as unknown as Agent;

function renderModal() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
      <ExportCiModal agent={agent} onClose={vi.fn()} />
    </NextIntlClientProvider>,
  );
}
const next = () => fireEvent.click(screen.getByRole("button", { name: "Continue" }));
const toInstall = () => {
  next();
  next();
  next();
};

afterEach(() => {
  cleanup();
  mutate.mockReset();
  downloadZip.mockClear();
  repos = [{ full_name: "o/a" }, { full_name: "o/b" }];
  preview = { files: baseFiles, skipped_skills: [], bundle_missing: false };
});

describe("ExportCiModal", () => {
  it("shows the four steps, one target and the imported repos", () => {
    renderModal();
    for (const l of ["Target", "Preview", "Configure", "Install"]) expect(screen.getByText(l)).toBeInTheDocument();
    expect(screen.getByText("GitHub Actions")).toBeInTheDocument();
    expect(screen.queryByText("CircleCI")).toBeNull();
    const select = screen.getByLabelText("Target repository") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["o/a", "o/b"]);
  });

  it("keeps a Configure choice across Back and Continue", () => {
    renderModal();
    next();
    next();
    fireEvent.click(screen.getByLabelText("PR comment"));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    next();
    expect(screen.getByLabelText("PR comment")).toBeChecked();
  });

  it("lists every file and only the workflow is editable", () => {
    renderModal();
    next();
    for (const f of baseFiles) expect(screen.getByRole("button", { name: new RegExp(f.path.replace(/[.]/g, "\\.")) })).toBeInTheDocument();
    expect(screen.getAllByText("· editable")).toHaveLength(1);
    expect(screen.getByLabelText(".github/workflows/devdigest-review.yml")).toBeInstanceOf(HTMLTextAreaElement);
    fireEvent.click(screen.getByRole("button", { name: /memory\.jsonl/ }));
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("lists .gitattributes only when the server returned it", () => {
    renderModal();
    next();
    expect(screen.queryByRole("button", { name: /\.gitattributes/ })).toBeNull();
    cleanup();
    preview = {
      files: [...baseFiles, { path: ".gitattributes", contents: "x\n", editable: false }],
      skipped_skills: [],
      bundle_missing: false,
    };
    renderModal();
    next();
    expect(screen.getByRole("button", { name: /\.gitattributes/ })).toBeInTheDocument();
  });

  it("disables Continue and shows the parse error for invalid YAML", () => {
    renderModal();
    next();
    fireEvent.change(screen.getByLabelText(".github/workflows/devdigest-review.yml"), { target: { value: "a: [b" } });
    expect(screen.getByText(/The workflow is not valid YAML:/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("blocks both paths when the runner bundle is missing", () => {
    preview = { files: baseFiles, skipped_skills: [], bundle_missing: true };
    renderModal();
    next();
    expect(screen.getByText(/Run pnpm build in agent-runner/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("asks to import a repo first and disables Continue", () => {
    repos = [];
    renderModal();
    expect(screen.getByText(/Import a repository first/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("defaults triggers, requires one, and lists post-as modes and notes", () => {
    renderModal();
    next();
    next();
    expect(screen.getByLabelText("pull_request:opened")).toBeChecked();
    expect(screen.getByLabelText("pull_request:synchronize")).toBeChecked();
    expect(screen.getByLabelText("pull_request:reopened")).not.toBeChecked();
    for (const l of ["GitHub review", "PR comment", "None (exit code only)"]) expect(screen.getByLabelText(l)).toBeInTheDocument();
    expect(screen.getByText(/OPENROUTER_API_KEY to the repository/)).toBeInTheDocument();
    expect(screen.getByText(/provided automatically/)).toBeInTheDocument();
    expect(screen.getByText(/branch protection/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("pull_request:opened"));
    fireEvent.click(screen.getByLabelText("pull_request:synchronize"));
    expect(screen.getByText("Select at least one trigger.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("shows the PR link and the three next steps after an install", () => {
    mutate.mockImplementation((_i, o) =>
      o.onSuccess({ installation: {}, files: [], pr_url: "https://github.com/o/a/pull/1", zip_base64: null }),
    );
    renderModal();
    toInstall();
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({ repo: "o/a", action: "open_pr", triggers: ["opened", "synchronize"] });
    expect(screen.getByRole("link", { name: "View pull request" })).toHaveAttribute("href", "https://github.com/o/a/pull/1");
    expect(screen.getByText("Review and merge the pull request.")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(3);
  });

  it("offers a zip when GitHub refuses, and the zip path sends action files", () => {
    mutate.mockImplementationOnce((_i, o) => o.onError(new ApiError("no permission", 502, "ci_github_failed")));
    renderModal();
    toInstall();
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(screen.getByText("GitHub refused the change: no permission")).toBeInTheDocument();
    mutate.mockImplementationOnce((_i, o) =>
      o.onSuccess({ installation: {}, files: [], pr_url: null, zip_base64: "AAAA" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Download zip instead" }));
    expect(mutate.mock.calls[1]?.[0]).toMatchObject({ action: "files" });
    expect(downloadZip).toHaveBeenCalledWith("AAAA", "devdigest-ci-o-a.zip");
  });

  it("shows the repo-taken message verbatim", () => {
    mutate.mockImplementation((_i, o) => o.onError(new ApiError("Other is already installed in o/a", 409, "ci_repo_taken")));
    renderModal();
    toInstall();
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(screen.getByText("Other is already installed in o/a")).toBeInTheDocument();
  });
});

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, ConventionSkillDraft } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/conventions.json";
import { ToastProvider } from "@/providers/toast";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const DRAFT: ConventionSkillDraft = {
  name: "repo-conventions",
  description: "2 house conventions extracted from acme/payments-api",
  type: "convention",
  body: "# repo-conventions\n\n## Async & concurrency\n- Always use async/await instead of .then() chains\n",
  evidence_files: ["src/api/users.ts"],
  candidate_ids: ["c1", "c2"],
};

const AGENTS: Agent[] = [
  {
    id: "ag-sec",
    name: "Security Reviewer",
    description: "",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    system_prompt: "sec",
    output_schema: null,
    enabled: true,
    version: 1,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
  },
  {
    id: "ag-gen",
    name: "General Reviewer",
    description: "",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    system_prompt: "gen",
    output_schema: null,
    enabled: true,
    version: 1,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
  },
];

const previewMutateAsync = vi.fn();
const createMutate = vi.fn();
vi.mock("@/lib/hooks/conventions", () => ({
  usePreviewConventionSkill: () => ({ mutateAsync: previewMutateAsync, isPending: false }),
  useCreateConventionSkill: () => ({ mutate: createMutate, isPending: false }),
}));
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => ({ data: AGENTS }) }));

import { ConventionSkillModal } from "./ConventionSkillModal";

afterEach(() => {
  cleanup();
  previewMutateAsync.mockReset();
  createMutate.mockClear();
  push.mockClear();
});

/** The body textarea — `getByDisplayValue` collapses whitespace, so a
 *  multi-line value cannot be matched that way (client INSIGHTS, 2026-09-20). */
const bodyTextarea = () => document.querySelector("textarea") as HTMLTextAreaElement;

async function renderModal(onClose = vi.fn()) {
  previewMutateAsync.mockResolvedValue(DRAFT);
  await act(async () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
        <ToastProvider>
          <ConventionSkillModal repoId="r1" repoName="acme/payments-api" candidateCount={2} onClose={onClose} />
        </ToastProvider>
      </NextIntlClientProvider>,
    );
  });
  return onClose;
}

describe("ConventionSkillModal", () => {
  it("fetches the draft once on open and prefills every field from it", async () => {
    await renderModal();
    expect(previewMutateAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Create skill from conventions")).toBeInTheDocument();
    expect(screen.getByText(/accepted conventions/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("repo-conventions")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2 house conventions extracted from acme/payments-api")).toBeInTheDocument();
    expect(bodyTextarea().value).toBe(DRAFT.body);
    expect(screen.getByText("repo-conventions.md")).toBeInTheDocument();
    expect(screen.getByText("unsaved")).toBeInTheDocument();
  });

  it("starts with no agent checked, says binding is optional, and still lets Create through", async () => {
    await renderModal();
    // `Checkbox` is a styled button with role="checkbox" + aria-checked, not an <input>.
    for (const box of screen.getAllByRole("checkbox")) expect(box.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(/Optional — nothing is preselected/)).toBeInTheDocument();
    expect(screen.getByText("Create skill").closest("button")).not.toBeDisabled();
  });

  it("Create with no agent submits an empty agent_ids", async () => {
    await renderModal();
    fireEvent.click(screen.getByText("Create skill"));
    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0]![0].agent_ids).toEqual([]);
  });

  it("the body is editable and the token estimate follows it", async () => {
    await renderModal();
    expect(screen.getByText(`≈ ${Math.ceil(DRAFT.body.length / 4)} tokens`)).toBeInTheDocument();
    fireEvent.change(bodyTextarea(), { target: { value: "x".repeat(400) } });
    expect(screen.getByText("≈ 100 tokens")).toBeInTheDocument();
  });

  it("Create submits the edited fields, the draft's candidate ids and the checked agent, then navigates", async () => {
    const onClose = await renderModal();
    fireEvent.change(screen.getByDisplayValue("repo-conventions"), { target: { value: "payments-conventions" } });
    fireEvent.change(bodyTextarea(), { target: { value: "# edited body" } });
    const security = screen
      .getAllByRole("checkbox")
      .find((b) => b.closest("label")?.textContent?.includes("Security Reviewer"))!;
    fireEvent.click(security);
    fireEvent.click(screen.getByText("Create skill"));

    expect(createMutate).toHaveBeenCalledTimes(1);
    const [payload, opts] = createMutate.mock.calls[0]!;
    expect(payload).toEqual({
      candidate_ids: ["c1", "c2"],
      name: "payments-conventions",
      description: DRAFT.description,
      type: "convention",
      body: "# edited body",
      enabled: true,
      agent_ids: ["ag-sec"],
    });
    act(() => opts.onSuccess({ skill_id: "sk-new" }));
    expect(onClose).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/skills/sk-new?tab=preview");
  });

  it("Cancel closes without creating", async () => {
    const onClose = await renderModal();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(createMutate).not.toHaveBeenCalled();
  });
});

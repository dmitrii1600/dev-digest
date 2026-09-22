import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/conventions.json";
import { CandidateCard } from "./CandidateCard";

afterEach(cleanup);

const CANDIDATE: ConventionCandidate = {
  id: "c1",
  repo_id: "r1",
  category: "async",
  rule: "Always use async/await instead of .then() chains",
  evidence_path: "src/api/users.ts",
  evidence_line: 23,
  evidence_snippet: "const user = await db.users.find(id);",
  confidence: 0.91,
  status: "pending",
  edited: false,
  skill_id: null,
  created_at: "2026-09-20T10:00:00.000Z",
};

function renderCard(candidate = CANDIDATE, onPatch = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <CandidateCard candidate={candidate} onPatch={onPatch} />
    </NextIntlClientProvider>,
  );
  return onPatch;
}

describe("CandidateCard", () => {
  it("shows the rule, category, file:line evidence, snippet and confidence", () => {
    renderCard();
    expect(screen.getByText("Always use async/await instead of .then() chains")).toBeInTheDocument();
    expect(screen.getByText("Async")).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:23")).toBeInTheDocument();
    expect(screen.getByText("const user = await db.users.find(id);")).toBeInTheDocument();
    expect(screen.getByText("91% conf")).toBeInTheDocument();
    expect(screen.getByText("Accept")).toBeInTheDocument();
    expect(screen.getByText("Reject")).toBeInTheDocument();
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  it("Accept patches status → accepted; clicking again on an accepted card returns it to pending", () => {
    const onPatch = renderCard();
    fireEvent.click(screen.getByText("Accept"));
    expect(onPatch).toHaveBeenCalledWith({ status: "accepted" });

    cleanup();
    const onPatch2 = renderCard({ ...CANDIDATE, status: "accepted" });
    fireEvent.click(screen.getByText("Accepted"));
    expect(onPatch2).toHaveBeenCalledWith({ status: "pending" });
  });

  it("Reject patches status → rejected", () => {
    const onPatch = renderCard();
    fireEvent.click(screen.getByText("Reject"));
    expect(onPatch).toHaveBeenCalledWith({ status: "rejected" });
  });

  it("Edit is inline: the rule becomes a textarea and the category a select; evidence stays read-only", () => {
    const onPatch = renderCard();
    fireEvent.click(screen.getByText("Edit"));
    const textarea = screen.getByDisplayValue("Always use async/await instead of .then() chains");
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    // the evidence is not editable
    expect(screen.queryByDisplayValue("const user = await db.users.find(id);")).toBeNull();
    expect(screen.queryByDisplayValue("src/api/users.ts")).toBeNull();

    fireEvent.change(textarea, { target: { value: "Prefer async/await; never chain .then()" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "style" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onPatch).toHaveBeenCalledWith({ rule: "Prefer async/await; never chain .then()", category: "style" });
    // back to read mode
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  it("Save sends only the fields that changed, and nothing when nothing changed", () => {
    const onPatch = renderCard();
    fireEvent.click(screen.getByText("Edit"));
    fireEvent.click(screen.getByText("Save"));
    expect(onPatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Edit"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "api" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onPatch).toHaveBeenCalledWith({ category: "api" });
  });

  it("Cancel and Escape leave edit mode without patching", () => {
    const onPatch = renderCard();
    fireEvent.click(screen.getByText("Edit"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.getByText("Edit")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Edit"));
    fireEvent.keyDown(screen.getByDisplayValue(CANDIDATE.rule), { key: "Escape" });
    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("shows the edited and In-skill badges when the flags are set", () => {
    renderCard({ ...CANDIDATE, edited: true, skill_id: "sk1", status: "accepted" });
    expect(screen.getByText("edited")).toBeInTheDocument();
    expect(screen.getByText("In skill")).toBeInTheDocument();
  });
});

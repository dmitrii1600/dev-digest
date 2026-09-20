import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/skills.json";
import { PreviewTab } from "./PreviewTab";

afterEach(cleanup);

const SKILL: Skill = {
  id: "sk1",
  name: "PR quality rubric",
  description: "House test-quality bar",
  type: "rubric",
  source: "manual",
  body: "# Rule\nOne assertion per test.",
  enabled: true,
  version: 1,
  evidence_files: null,
};

function renderTab(skill: Skill) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <PreviewTab skill={skill} />
    </NextIntlClientProvider>,
  );
}

describe("PreviewTab", () => {
  it("renders the body as Markdown, with no untrusted notice for a manual skill", () => {
    renderTab(SKILL);
    expect(screen.getByText("Rule")).toBeInTheDocument();
    expect(screen.getByText("One assertion per test.")).toBeInTheDocument();
    expect(screen.queryByText(/untrusted source/)).toBeNull();
  });

  it("shows the untrusted notice for an imported skill", () => {
    renderTab({ ...SKILL, source: "imported_file" });
    expect(
      screen.getByText(/came from an untrusted source/),
    ).toBeInTheDocument();
  });

  it("renders nothing interactive — it is a read-only tab", () => {
    renderTab(SKILL);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });
});

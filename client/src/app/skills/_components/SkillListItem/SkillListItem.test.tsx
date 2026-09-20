import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { SkillListItem } from "./SkillListItem";

afterEach(cleanup);

function skill(o: Partial<Skill> = {}): Skill {
  return {
    id: "s1",
    name: "PR quality rubric",
    description: "House test-quality bar",
    type: "rubric",
    source: "manual",
    body: "# Rule\nWrite one assertion per test.",
    enabled: true,
    version: 1,
    evidence_files: null,
    ...o,
  };
}

function renderItem(props: Partial<React.ComponentProps<typeof SkillListItem>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <SkillListItem skill={skill(props.skill)} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("SkillListItem", () => {
  it("renders the name, type badge and source badge for a manual skill", () => {
    renderItem();
    expect(screen.getByText("PR quality rubric")).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.queryByText("needs vetting")).toBeNull();
  });

  it("shows 'needs vetting' instead of the source badge for a disabled imported skill", () => {
    renderItem({ skill: skill({ source: "imported_file", enabled: false }) });
    expect(screen.getByText("needs vetting")).toBeInTheDocument();
    expect(screen.queryByText("Imported")).toBeNull();
  });

  it("does not flag a disabled MANUAL skill as needing vetting", () => {
    renderItem({ skill: skill({ source: "manual", enabled: false }) });
    expect(screen.queryByText("needs vetting")).toBeNull();
  });

  it("calls onClick when the row is clicked", () => {
    const onClick = vi.fn();
    renderItem({ onClick });
    fireEvent.click(screen.getByText("PR quality rubric"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("toggles enabled without triggering the row's onClick", () => {
    const onClick = vi.fn();
    const onToggle = vi.fn();
    renderItem({ onClick, onToggle });
    fireEvent.click(screen.getByRole("switch"));
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(onClick).not.toHaveBeenCalled();
  });
});

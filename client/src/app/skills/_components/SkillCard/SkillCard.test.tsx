import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";

import { SkillCard } from "./SkillCard";

const SKILL: Skill = {
  id: "s1",
  name: "pr-quality-rubric",
  description: "Rubric for evaluating overall PR quality",
  type: "rubric",
  source: "manual",
  body: "# PR Quality Rubric",
  enabled: true,
  version: 5,
  evidence_files: null,
};

const IMPORTED: Skill = {
  ...SKILL,
  id: "s2",
  name: "phantom-api-gate",
  description: "",
  type: "security",
  source: "imported_file",
  enabled: false,
  version: 1,
};

afterEach(cleanup);

function renderCard(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SkillCard", () => {
  it("shows the name, description, type, source and version", () => {
    renderCard(<SkillCard skill={SKILL} />);
    expect(screen.getByText("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.getByText("Rubric for evaluating overall PR quality")).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("v5")).toBeInTheDocument();
  });

  it("falls back to a placeholder when there is no description", () => {
    renderCard(<SkillCard skill={IMPORTED} />);
    expect(screen.getByText("No description")).toBeInTheDocument();
  });

  it("flags an unvetted imported skill instead of showing its source", () => {
    renderCard(<SkillCard skill={IMPORTED} />);
    expect(screen.getByText("needs vetting")).toBeInTheDocument();
    expect(screen.queryByText("Imported")).toBeNull();
  });

  it("opens on click", () => {
    const onClick = vi.fn();
    renderCard(<SkillCard skill={SKILL} onClick={onClick} />);
    fireEvent.click(screen.getByText("pr-quality-rubric"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("toggles enabled without opening the skill", () => {
    const onClick = vi.fn();
    const onToggle = vi.fn();
    renderCard(<SkillCard skill={SKILL} onClick={onClick} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(onClick).not.toHaveBeenCalled();
  });
});

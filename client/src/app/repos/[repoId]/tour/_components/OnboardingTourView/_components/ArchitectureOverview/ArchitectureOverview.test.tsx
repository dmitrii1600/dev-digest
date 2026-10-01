import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../../messages/en/onboarding.json";

vi.mock("@/components/mermaid-diagram", () => ({
  MermaidDiagram: ({ chart }: { chart: string }) => <div data-testid="diagram">{chart}</div>,
}));

import { ArchitectureOverview } from "./ArchitectureOverview";

afterEach(cleanup);

const renderIt = (prose: string, diagram: string | null) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      <ArchitectureOverview prose={prose} diagram={diagram} />
    </NextIntlClientProvider>,
  );

describe("ArchitectureOverview", () => {
  it("renders prose as Markdown, shows raw HTML as text, and mounts the diagram when given", () => {
    renderIt("The **core** talks to a DB.\n\n<script>alert(1)</script>", "flowchart LR\nA-->B");
    expect(screen.getByText("core").tagName).toBe("STRONG");
    expect(screen.getByText("<script>alert(1)</script>", { exact: false })).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByTestId("diagram")).toHaveTextContent("flowchart LR");
  });

  it("renders prose alone, with no diagram area, when there is no diagram", () => {
    renderIt("Just prose.", null);
    expect(screen.getByText("Just prose.")).toBeInTheDocument();
    expect(screen.queryByTestId("diagram")).not.toBeInTheDocument();
    expect(screen.getByText("Just prose.").closest("div")?.parentElement?.children).toHaveLength(1);
  });

  it("says so when there is nothing to show", () => {
    renderIt("   ", null);
    expect(screen.getByText("No architecture overview was produced.")).toBeInTheDocument();
  });
});

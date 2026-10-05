import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../../messages/en/onboarding.json";
import { CriticalPaths } from "./CriticalPaths";

afterEach(cleanup);

const renderIt = (files: { path: string; reason: string | null }[]) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      <CriticalPaths files={files} fullName="acme/api" branch="main" />
    </NextIntlClientProvider>,
  );

describe("CriticalPaths", () => {
  it("opens each file on GitHub at the default branch, and keeps long paths wrapping with Open visible", () => {
    const long = `src/${"deep/".repeat(60)}file.ts`;
    renderIt([
      { path: "src/server.ts", reason: "Entry point" },
      { path: long, reason: null },
    ]);
    const open = screen.getByRole("link", { name: "Open src/server.ts on GitHub" });
    expect(open).toHaveAttribute("href", "https://github.com/acme/api/blob/main/src/server.ts");
    expect(open).toHaveAttribute("target", "_blank");
    expect(open.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText("Entry point")).toBeInTheDocument();
    expect(screen.getByText("No reason given")).toBeInTheDocument();

    const row = screen.getByText(long).parentElement as HTMLElement;
    expect(row.style.overflowWrap).toBe("anywhere");
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("shows the empty line when there are no files", () => {
    renderIt([]);
    expect(screen.getByText("No critical paths were found in the index.")).toBeInTheDocument();
  });
});

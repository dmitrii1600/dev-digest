import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../../messages/en/onboarding.json";
import { ReadingPath } from "./ReadingPath";

afterEach(cleanup);

const renderIt = (files: { path: string; reason: string | null }[]) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      <ReadingPath files={files} fullName="acme/api" branch="main" />
    </NextIntlClientProvider>,
  );

describe("ReadingPath", () => {
  it("numbers files in the given order, links them to GitHub, and mutes a missing reason", () => {
    renderIt([
      { path: "src/a.ts", reason: "Start here" },
      { path: "src/b.ts", reason: null },
      { path: "src/c.ts", reason: "Then this" },
    ]);
    expect(screen.getAllByRole("listitem").map((li) => li.firstElementChild?.textContent)).toEqual(["1", "2", "3"]);
    expect(screen.getByRole("link", { name: "src/a.ts" })).toHaveAttribute(
      "href",
      "https://github.com/acme/api/blob/main/src/a.ts",
    );
    expect(screen.getByText("Start here")).toBeInTheDocument();
    expect(screen.getByText("No reason given")).toBeInTheDocument();
  });

  it("shows the empty line when there are no files", () => {
    renderIt([]);
    expect(screen.getByText("No files to read were found in the index.")).toBeInTheDocument();
  });

  it("EC-11: a path or a reason longer than its row wraps in place and the link still opens the file", () => {
    const longPath = `src/${"nested/".repeat(50)}file.ts`;
    const longReason = "because ".repeat(60).trim();
    renderIt([{ path: longPath, reason: longReason }]);

    const link = screen.getByRole("link", { name: longPath });
    expect(link).toHaveAttribute("href", expect.stringContaining("https://github.com/acme/api/blob/main/src/nested/"));
    const cell = link.parentElement as HTMLElement;
    expect(cell.style.overflowWrap).toBe("anywhere");
    expect(Number.parseFloat(cell.style.minWidth)).toBe(0);
    expect(screen.getByText(longReason)).toBeInTheDocument();
  });
});

/**
 * DiffGroup — one role section of the Files changed tab (Smart Diff, L03).
 * Real `prReview` + `shell` messages so a copy edit that breaks these
 * assertions is caught, not silently rendered as a missing key.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";
import type { PrFile } from "@devdigest/shared";
import prReview from "../../../../../../../../../../messages/en/prReview.json";
import shell from "../../../../../../../../../../messages/en/shell.json";
import { DiffGroup } from "./DiffGroup";

afterEach(cleanup);

function file(path: string): PrFile {
  return { path, additions: 1, deletions: 0, patch: null };
}

function renderGroup(props: Partial<ComponentProps<typeof DiffGroup>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
      <DiffGroup
        role="core"
        files={[file("src/app.ts")]}
        filesWithFindings={0}
        hasReview={false}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("DiffGroup header", () => {
  it("renders the role label, its hint, and the findings counter when there is one", () => {
    renderGroup({
      role: "core",
      files: [file("src/app.ts")],
      filesWithFindings: 2,
      hasReview: true,
    });
    expect(screen.getByText(prReview.smartDiff.coreLabel)).toBeInTheDocument();
    expect(screen.getByText(prReview.smartDiff.coreHint)).toBeInTheDocument();
    expect(screen.getByText(/2 files with findings/)).toBeInTheDocument();
    expect(screen.getByText("1 files")).toBeInTheDocument();
  });

  it("hides the findings counter when it is zero", () => {
    renderGroup({ filesWithFindings: 0, hasReview: true });
    expect(screen.queryByText(/files with findings/)).not.toBeInTheDocument();
  });

  it("hides the findings counter when there has been no review yet, even if a stale count is passed", () => {
    renderGroup({ filesWithFindings: 3, hasReview: false });
    expect(screen.queryByText(/files with findings/)).not.toBeInTheDocument();
  });
});

describe("DiffGroup collapse state", () => {
  it("boilerplate starts collapsed — its file is absent until the header is clicked", () => {
    renderGroup({ role: "boilerplate", files: [file("pnpm-lock.yaml")] });
    expect(screen.queryByText("pnpm-lock.yaml")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();
  });

  it("core starts open", () => {
    renderGroup({ role: "core", files: [file("src/app.ts")] });
    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
    expect(screen.getByText("src/app.ts")).toBeInTheDocument();
  });
});

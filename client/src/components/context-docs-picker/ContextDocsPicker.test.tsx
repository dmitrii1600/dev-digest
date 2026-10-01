import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextFileList } from "@devdigest/shared";
import messages from "../../../messages/en/context.json";

let previewError = false;
const refetch = vi.fn();
vi.mock("@/lib/hooks/project-context", () => ({
  useContextFile: (_repoId: string, path: string) => ({
    data: previewError ? undefined : { path, content: "# Hello\n\nrendered body" },
    isLoading: false,
    isError: previewError,
    refetch,
  }),
}));

import { ContextDocsPicker } from "./ContextDocsPicker";

const LIST: ContextFileList = {
  cloned: true,
  total: 3,
  files: [
    { path: "docs/b.md", kind: "docs", tokens: 20 },
    { path: "specs/a.md", kind: "specs", tokens: 10 },
    { path: "INSIGHTS.md", kind: "insights", tokens: 5 },
  ],
};
const OK = { isLoading: false, isError: false, onRetry: vi.fn() };

afterEach(() => {
  cleanup();
  previewError = false;
  refetch.mockClear();
});

function renderPicker(over: Partial<React.ComponentProps<typeof ContextDocsPicker>> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ContextDocsPicker repoId="r1" list={LIST} listState={OK} attached={[]} onChange={onChange} {...over} />
    </NextIntlClientProvider>,
  );
  return { onChange, ...utils };
}

describe("ContextDocsPicker", () => {
  it("renders rows with path, kind badge and Preview, and appends on check", () => {
    const { onChange } = renderPicker({ attached: ["specs/a.md"] });
    expect(screen.getByText("1 of 3 attached")).toBeInTheDocument();
    expect(screen.getByText("insights")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Preview / })).toHaveLength(3);
    fireEvent.click(screen.getByRole("checkbox", { name: /docs\/b\.md/ }));
    expect(onChange).toHaveBeenCalledWith(["specs/a.md", "docs/b.md"]);
    fireEvent.click(screen.getByRole("checkbox", { name: /specs\/a\.md/ }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("reorders an attached row with ArrowDown on its handle", () => {
    const { onChange } = renderPicker({ attached: ["specs/a.md", "docs/b.md"] });
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder specs/a.md" }), { key: "ArrowDown" });
    expect(onChange).toHaveBeenCalledWith(["docs/b.md", "specs/a.md"]);
  });

  it("shows the token estimate only for attached, existing rows, and flags a missing row", () => {
    const { rerender } = renderPicker({ attached: ["specs/a.md", "gone.md"] });
    expect(screen.getByText("≈ 10 tokens")).toBeInTheDocument();
    expect(screen.getByText("missing")).toBeInTheDocument();
    rerender(
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ContextDocsPicker
          repoId="r1"
          list={LIST}
          listState={OK}
          attached={["specs/a.md", "gone.md", "docs/b.md"]}
          onChange={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("≈ 30 tokens")).toBeInTheDocument();
  });

  it("keeps the attached count when a filter matches nothing", () => {
    renderPicker({ attached: ["specs/a.md"] });
    fireEvent.change(screen.getByPlaceholderText("Filter documents…"), { target: { value: "zzz" } });
    expect(screen.getByText("No documents match")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 attached")).toBeInTheDocument();
  });

  it("shows the not-cloned and no-files empty states without checkboxes", () => {
    renderPicker({ list: { cloned: false, total: 0, files: [] } });
    expect(screen.getByText("This repo is not cloned yet")).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    cleanup();
    renderPicker({ list: { cloned: true, total: 0, files: [] } });
    expect(screen.getByText(/Only \.md files/)).toBeInTheDocument();
  });

  it("previews a document as rendered Markdown, and offers retry when it fails", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Preview specs/a.md" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("rendered body")).toBeInTheDocument();
    cleanup();
    previewError = true;
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Preview specs/a.md" }));
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(refetch).toHaveBeenCalled();
  });
});

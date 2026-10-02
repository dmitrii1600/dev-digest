import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
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
    { path: "specs/a.md", kind: "specs", tokens: 10, used_by: 2 },
    { path: "INSIGHTS.md", kind: "insights", tokens: 5 },
  ],
};
const onRefresh = vi.fn();
const OK = { isLoading: false, isError: false, onRetry: vi.fn(), onRefresh };

afterEach(() => {
  cleanup();
  previewError = false;
  refetch.mockClear();
  onRefresh.mockClear();
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
    expect(screen.getByText("No documents found")).toBeInTheDocument();
    expect(screen.getByText(/Only \.md files/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows each row's token count, and an accessible dash when it is unknown", () => {
    const list: ContextFileList = {
      cloned: true,
      total: 5,
      files: [
        { path: "a.md", kind: "docs", tokens: 1234 },
        { path: "b.md", kind: "docs", tokens: 999 },
        { path: "c.md", kind: "docs", tokens: 1000 },
        { path: "d.md", kind: "docs", tokens: null },
        { path: "e.md", kind: "docs" },
      ],
    };
    renderPicker({ list, attached: ["a.md", "d.md"] });
    expect(screen.getByText("1.2K tokens")).toBeInTheDocument();
    expect(screen.getByText("999 tokens")).toBeInTheDocument();
    expect(screen.getByText("1K tokens")).toBeInTheDocument();
    expect(screen.getAllByLabelText("token count unavailable")).toHaveLength(2);
    expect(screen.getAllByLabelText("token count unavailable")[0]).toHaveTextContent("—");
    // d.md (null) is attached but adds nothing to the total.
    expect(screen.getByText("≈ 1234 tokens")).toBeInTheDocument();
  });

  it("flags totals over the 4K soft cap with a text badge and never disables attaching", () => {
    const list = (tokens: number): ContextFileList => ({
      cloned: true,
      total: 2,
      files: [
        { path: "a.md", kind: "docs", tokens },
        { path: "b.md", kind: "docs", tokens: 1 },
      ],
    });
    const { rerender } = renderPicker({ list: list(4000), attached: ["a.md"] });
    expect(screen.queryByText("over 4K soft cap")).not.toBeInTheDocument();
    expect(screen.getByText("≈ 4000 tokens").parentElement?.style.color).toBe("");
    rerender(
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ContextDocsPicker repoId="r1" list={list(4001)} listState={OK} attached={["a.md"]} onChange={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("over 4K soft cap")).toBeInTheDocument();
    // AC-14: the total itself turns critical-coloured; the text badge is what carries it for non-colour users.
    expect(screen.getByText("≈ 4001 tokens").parentElement?.style.color).toBe("var(--crit)");
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeEnabled();
  });

  it("previews in a drawer with row metadata, attaches like the checkbox, and closes on Escape with focus back", () => {
    const { onChange, rerender } = renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Preview specs/a.md" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("specs/a.md")).toBeInTheDocument();
    expect(within(dialog).getByText("specs")).toBeInTheDocument();
    expect(within(dialog).getByText("Used by 2 agents")).toBeInTheDocument();
    expect(within(dialog).getByText("10 tokens")).toBeInTheDocument();
    expect(within(dialog).getByText("rendered body")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Attach" }));
    expect(onChange).toHaveBeenCalledWith(["specs/a.md"]);

    rerender(
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ContextDocsPicker repoId="r1" list={LIST} listState={OK} attached={["specs/a.md"]} onChange={onChange} />
      </NextIntlClientProvider>,
    );
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Attached" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /specs\/a\.md/ })).toBeChecked();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview specs/a.md" })).toHaveFocus();
  });

  it("detaches from the drawer's Attached button exactly as unchecking the row does (AC-12)", () => {
    const { onChange } = renderPicker({ attached: ["specs/a.md", "docs/b.md"] });
    fireEvent.click(screen.getByRole("checkbox", { name: /specs\/a\.md/ }));
    const viaCheckbox = onChange.mock.calls.at(-1);
    onChange.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Preview specs/a.md" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Attached" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]).toEqual(viaCheckbox);
    expect(onChange).toHaveBeenCalledWith(["docs/b.md"]);
  });

  it("offers retry when the preview fails", () => {
    previewError = true;
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Preview specs/a.md" }));
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(refetch).toHaveBeenCalled();
  });
});

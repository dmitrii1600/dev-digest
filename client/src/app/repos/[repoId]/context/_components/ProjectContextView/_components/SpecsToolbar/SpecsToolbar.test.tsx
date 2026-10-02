import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../../messages/en/context.json";
import { SpecsToolbar } from "./SpecsToolbar";

afterEach(cleanup);

function renderToolbar(canWrite: boolean) {
  const h = { onNewFile: vi.fn(), onNewFolder: vi.fn(), onUpload: vi.fn(), onRefresh: vi.fn() };
  render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <SpecsToolbar canWrite={canWrite} {...h} />
    </NextIntlClientProvider>,
  );
  return h;
}

describe("SpecsToolbar", () => {
  it("lists New file, New folder, Upload, Refresh in order and wires each", () => {
    const h = renderToolbar(true);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "New file",
      "New folder",
      "Upload",
      "Refresh",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "New file" }));
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(h.onNewFile).toHaveBeenCalledTimes(1);
    expect(h.onNewFolder).toHaveBeenCalledTimes(1);
    expect(h.onRefresh).toHaveBeenCalledTimes(1);

    const file = new File(["# x"], "x.md", { type: "text/markdown" });
    fireEvent.change(screen.getByLabelText("Choose a Markdown file to upload"), { target: { files: [file] } });
    expect(h.onUpload).toHaveBeenCalledWith(file);
  });

  it("disables the three write actions when the repo is not cloned, but not Refresh", () => {
    renderToolbar(false);
    for (const name of ["New file", "New folder", "Upload"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
  });
});

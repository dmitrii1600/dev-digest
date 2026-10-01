import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../../messages/en/context.json";
import { NameDialog } from "./NameDialog";

afterEach(cleanup);

function renderDialog(over: Partial<React.ComponentProps<typeof NameDialog>> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <NameDialog kind="file" busy={false} error={null} onConfirm={onConfirm} onCancel={onCancel} {...over} />
    </NextIntlClientProvider>,
  );
  return { onConfirm, onCancel };
}

describe("NameDialog", () => {
  it("pre-fills untitled.md, lets the name be edited, and confirms it", () => {
    const { onConfirm } = renderDialog();
    const input = screen.getByLabelText("Name");
    expect(input).toHaveValue("untitled.md");
    fireEvent.change(input, { target: { value: "notes.md" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onConfirm).toHaveBeenCalledWith("notes.md");
  });

  it("pre-fills new-folder for a folder, cancels, and shows a server error", () => {
    const { onConfirm, onCancel } = renderDialog({ kind: "folder", error: "That name can’t be used" });
    expect(screen.getByLabelText("Name")).toHaveValue("new-folder");
    expect(screen.getByRole("alert")).toHaveTextContent("That name can’t be used");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

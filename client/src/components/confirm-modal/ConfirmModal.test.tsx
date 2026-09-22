import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import { ConfirmModal } from "./ConfirmModal";

afterEach(cleanup);

function renderModal(over: Partial<React.ComponentProps<typeof ConfirmModal>> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmModal
      title="Delete skill?"
      body="This cannot be undone."
      confirmLabel="Delete"
      cancelLabel="Keep it"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...over}
    />,
  );
  return { onConfirm, onCancel };
}

describe("ConfirmModal", () => {
  it("renders title, body and both labels inside a dialog", () => {
    renderModal();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Delete skill?")).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.getByText("Keep it")).toBeInTheDocument();
  });

  it("calls onConfirm from the danger button only", () => {
    const { onConfirm, onCancel } = renderModal();
    fireEvent.click(screen.getByText("Delete"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("offers two ways to cancel: the Cancel button and the header X", () => {
    const { onConfirm, onCancel } = renderModal();
    fireEvent.click(screen.getByText("Keep it"));
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("disables both buttons while busy", () => {
    renderModal({ busy: true });
    expect(screen.getByText("Delete").closest("button")).toBeDisabled();
    expect(screen.getByText("Keep it").closest("button")).toBeDisabled();
  });
});

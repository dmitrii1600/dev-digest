import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/skills.json";
import { ToastProvider } from "@/providers/toast";

vi.mock("@/lib/hooks/skills", () => ({
  useCreateSkill: () => ({ mutate: vi.fn(), isPending: false }),
  usePreviewSkillImport: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
  useImportSkill: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
  usePreviewSkillUrlImport: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
  useImportSkillFromUrl: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
}));

import { AddSkillModal, type AddSkillTab } from ".";

afterEach(cleanup);

function renderModal(initialTab?: AddSkillTab) {
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <AddSkillModal onClose={onClose} initialTab={initialTab} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
  return onClose;
}

describe("AddSkillModal", () => {
  it("is a dialog with the three tabs, opening on Create by default", () => {
    renderModal();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Add skill")).toBeInTheDocument();
    expect(screen.getByText("Create")).toBeInTheDocument();
    expect(screen.getByText("From file")).toBeInTheDocument();
    expect(screen.getByText("Import from URL")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("pr-quality-rubric")).toBeInTheDocument();
  });

  it("switches between the file picker and the URL input without closing", () => {
    const onClose = renderModal();
    fireEvent.click(screen.getByText("From file"));
    expect(screen.getByLabelText("Import from file")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Import from URL"));
    expect(screen.getByPlaceholderText(/raw.githubusercontent/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Create"));
    expect(screen.getByPlaceholderText("pr-quality-rubric")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("honours initialTab and closes from the header X", () => {
    const onClose = renderModal("url");
    expect(screen.getByPlaceholderText(/raw.githubusercontent/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

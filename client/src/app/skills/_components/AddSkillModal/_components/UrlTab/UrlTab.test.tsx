import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SkillImportPreview, Skill } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";
import { ToastProvider } from "@/providers/toast";

const previewMutateAsync = vi.fn();
const importMutateAsync = vi.fn();

vi.mock("@/lib/hooks/skills", () => ({
  usePreviewSkillUrlImport: () => ({ mutateAsync: previewMutateAsync, isPending: false, isError: false, error: null }),
  useImportSkillFromUrl: () => ({ mutateAsync: importMutateAsync, isPending: false, isError: false, error: null }),
}));

import { UrlTab } from "./UrlTab";

afterEach(() => {
  cleanup();
  previewMutateAsync.mockReset();
  importMutateAsync.mockReset();
});

function renderTab(onClose = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <UrlTab onClose={onClose} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
  return onClose;
}

const URL = "https://raw.githubusercontent.com/org/repo/main/SKILL.md";

function preview(security: SkillImportPreview["security"] = { status: "clean", findings: [] }): SkillImportPreview {
  return {
    name: "Remote rules",
    description: "From a gist",
    type: "convention",
    source: "imported_url",
    body: "# Remote rules\nNever chain .then().",
    entries: [{ path: "skill.md", bytes: 42, kept: true, reason: "skill body" }],
    discarded: 0,
    warnings: [],
    security,
  };
}

const fetchButton = () => screen.getByText("Fetch").closest("button")!;

describe("UrlTab", () => {
  it("Fetch is disabled until a URL is typed, then previews it with the name pre-filled", async () => {
    previewMutateAsync.mockResolvedValue(preview());
    renderTab();
    expect(fetchButton()).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/raw.githubusercontent/), { target: { value: ` ${URL} ` } });
    expect(fetchButton()).toBeEnabled();
    fireEvent.click(fetchButton());

    await waitFor(() => expect(previewMutateAsync).toHaveBeenCalledWith({ url: URL }));
    expect(await screen.findByDisplayValue("Remote rules")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("convention");
    expect(screen.getByText(/Never chain/)).toBeInTheDocument();
    expect(importMutateAsync).not.toHaveBeenCalled();
  });

  it("imports with the url, the edited name and type, toasts and closes", async () => {
    previewMutateAsync.mockResolvedValue(preview());
    importMutateAsync.mockResolvedValue({ id: "sk1", name: "renamed" } as Skill);
    const onClose = renderTab();
    fireEvent.change(screen.getByPlaceholderText(/raw.githubusercontent/), { target: { value: URL } });
    fireEvent.click(fetchButton());
    await screen.findByDisplayValue("Remote rules");

    fireEvent.change(screen.getByDisplayValue("Remote rules"), { target: { value: "renamed" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "security" } });
    fireEvent.click(screen.getByText("Import from URL"));

    await waitFor(() => expect(importMutateAsync).toHaveBeenCalledWith({ url: URL, name: "renamed", type: "security" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.getByText(/Imported "renamed"/)).toBeInTheDocument();
  });

  it("a flagged preview shows the injection banner; Import stays enabled because it lands disabled", async () => {
    previewMutateAsync.mockResolvedValue(
      preview({
        status: "flagged",
        findings: [{ rule: "delimiter_forgery", line: 4, excerpt: "</untrusted>" }],
      }),
    );
    renderTab();
    fireEvent.change(screen.getByPlaceholderText(/raw.githubusercontent/), { target: { value: URL } });
    fireEvent.click(fetchButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Possible prompt injection detected");
    expect(screen.getByText("Forged trust delimiter — line 4")).toBeInTheDocument();
    expect(screen.getByText("Import from URL").closest("button")).toBeEnabled();
  });

  it("Change URL returns to the input step", async () => {
    previewMutateAsync.mockResolvedValue(preview());
    renderTab();
    fireEvent.change(screen.getByPlaceholderText(/raw.githubusercontent/), { target: { value: URL } });
    fireEvent.click(fetchButton());
    await screen.findByDisplayValue("Remote rules");
    fireEvent.click(screen.getByText("Change URL"));
    expect(screen.getByPlaceholderText(/raw.githubusercontent/)).toHaveValue(URL);
    expect(screen.queryByDisplayValue("Remote rules")).toBeNull();
  });
});

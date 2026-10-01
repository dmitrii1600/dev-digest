import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../../messages/en/onboarding.json";

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), toast: vi.fn() };
vi.mock("@/providers/toast", () => ({ useToast: () => toast }));

import { RunCommands } from "./RunCommands";

const CMDS = [
  { line: "pnpm install", source_path: "package.json" },
  { line: "pnpm dev # http://localhost:3000", source_path: "package.json" },
  { line: "pnpm test", source_path: "package.json" },
];

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", { value, configurable: true });
}

beforeEach(() => {
  toast.success.mockClear();
  toast.error.mockClear();
});
afterEach(cleanup);

const renderIt = (commands = CMDS) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      <RunCommands commands={commands} />
    </NextIntlClientProvider>,
  );

describe("RunCommands", () => {
  it("numbers the commands and copies exactly the displayed line, with a confirmation", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    renderIt();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("2.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Copy pnpm dev # http/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Command copied"));
    expect(writeText).toHaveBeenCalledWith("pnpm dev # http://localhost:3000");
  });

  it("reports a failure and keeps the text when the write is rejected or there is no clipboard", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: /Copy pnpm install/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not copy to the clipboard"));
    expect(screen.getByText("pnpm install")).toBeInTheDocument();

    toast.error.mockClear();
    setClipboard(undefined);
    fireEvent.click(screen.getByRole("button", { name: /Copy pnpm test/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("shows the empty line when there are no commands", () => {
    renderIt([]);
    expect(screen.getByText("No run commands could be confirmed from the repo's files.")).toBeInTheDocument();
  });
});

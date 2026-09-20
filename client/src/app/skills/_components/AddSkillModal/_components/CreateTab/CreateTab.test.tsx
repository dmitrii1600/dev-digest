import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/skills.json";
import { ToastProvider } from "@/providers/toast";

const mutate = vi.fn();
vi.mock("@/lib/hooks/skills", () => ({
  useCreateSkill: () => ({ mutate, isPending: false }),
}));

import { CreateTab } from "./CreateTab";

afterEach(() => {
  cleanup();
  mutate.mockReset();
});

function renderTab() {
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <CreateTab onClose={onClose} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
  return onClose;
}

const createButton = () => screen.getByText("Create skill", { selector: "button, button *" }).closest("button")!;

describe("CreateTab", () => {
  it("renders the four fields with Create disabled until name and body are filled", () => {
    renderTab();
    expect(screen.getByPlaceholderText("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("What this skill asks the reviewer to check")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("custom");
    expect(screen.getByPlaceholderText(/Describe the rule/)).toBeInTheDocument();
    expect(createButton()).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("pr-quality-rubric"), { target: { value: "my-rule" } });
    expect(createButton()).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/Describe the rule/), { target: { value: "# Rule" } });
    expect(createButton()).toBeEnabled();
  });

  it("submits name / description / type / body and closes on success", () => {
    const onClose = renderTab();
    fireEvent.change(screen.getByPlaceholderText("pr-quality-rubric"), { target: { value: "  my-rule " } });
    fireEvent.change(screen.getByPlaceholderText("What this skill asks the reviewer to check"), {
      target: { value: "Checks a thing" },
    });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "security" } });
    fireEvent.change(screen.getByPlaceholderText(/Describe the rule/), { target: { value: "# Rule\nBody" } });
    fireEvent.click(createButton());

    expect(mutate).toHaveBeenCalledTimes(1);
    const [input, opts] = mutate.mock.calls[0]!;
    expect(input).toEqual({ name: "my-rule", description: "Checks a thing", type: "security", body: "# Rule\nBody" });
    expect(onClose).not.toHaveBeenCalled();

    act(() => opts.onSuccess({ id: "s9", name: "my-rule" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Created "my-rule"')).toBeInTheDocument();
  });

  it("Cancel closes without creating", () => {
    const onClose = renderTab();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mutate).not.toHaveBeenCalled();
  });
});

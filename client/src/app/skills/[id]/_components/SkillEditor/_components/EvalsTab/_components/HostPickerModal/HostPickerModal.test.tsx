import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../../../messages/en/skills.json";
import { HostPickerModal } from "./HostPickerModal";

afterEach(cleanup);

const HOSTS = [
  { id: "ag1", name: "Security Reviewer" },
  { id: "ag2", name: "Style Reviewer" },
];

function mount(lastHostId?: string | null, hosts = HOSTS) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <HostPickerModal hosts={hosts} lastHostId={lastHostId} onConfirm={onConfirm} onCancel={onCancel} />
    </NextIntlClientProvider>,
  );
  return { onConfirm, onCancel };
}

describe("HostPickerModal", () => {
  it("defaults to the host of the latest run when it is still linked, otherwise to the first agent", () => {
    mount("ag2");
    expect(screen.getByLabelText("Host agent")).toHaveValue("ag2");
    cleanup();

    mount("ag-gone");
    expect(screen.getByLabelText("Host agent")).toHaveValue("ag1");
    cleanup();

    mount(null);
    expect(screen.getByLabelText("Host agent")).toHaveValue("ag1");
  });

  it("Run confirms the chosen host; Cancel and the X make no call to confirm", () => {
    const { onConfirm, onCancel } = mount("ag1");
    expect(screen.getByText("Run on which agent?")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Host agent"), { target: { value: "ag2" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("ag2");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("with no linked agent there is nothing to confirm", () => {
    mount(null, []);
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });
});

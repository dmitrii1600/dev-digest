import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../messages/en/eval.json";
import { WindowSelect } from "./WindowSelect";

afterEach(cleanup);

describe("WindowSelect", () => {
  it("offers the four windows by label and reports the chosen key", () => {
    const onChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
        <WindowSelect value="30d" onChange={onChange} />
      </NextIntlClientProvider>,
    );

    const select = screen.getByRole("combobox", { name: "Time window" });
    expect(select).toHaveValue("30d");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["7 days", "30 days", "90 days", "All"]);

    fireEvent.change(select, { target: { value: "7d" } });
    expect(onChange).toHaveBeenCalledWith("7d");
    fireEvent.change(select, { target: { value: "all" } });
    expect(onChange).toHaveBeenLastCalledWith("all");
  });
});

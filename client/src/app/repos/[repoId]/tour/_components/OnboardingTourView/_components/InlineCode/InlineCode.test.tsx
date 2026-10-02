import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { InlineCode } from "./InlineCode";

afterEach(cleanup);

describe("InlineCode", () => {
  it("renders backtick spans as <code> and keeps the rest as text", () => {
    const { container } = render(
      <p>
        <InlineCode text="Add a table to `server/src/db/schema/core.ts` and export it" />
      </p>,
    );
    expect(screen.getByText("server/src/db/schema/core.ts").tagName).toBe("CODE");
    expect(container.textContent).toBe("Add a table to server/src/db/schema/core.ts and export it");
  });

  it("never parses markup and leaves an unmatched backtick as text", () => {
    const { container } = render(
      <p>
        <InlineCode text="<b>bold</b> and a stray ` tick" />
      </p>,
    );
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("code")).toBeNull();
    expect(container.textContent).toBe("<b>bold</b> and a stray ` tick");
  });
});

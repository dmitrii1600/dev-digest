import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { DownstreamImpact } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/blast.json";
import { BlastGroup } from "./BlastGroup";

afterEach(cleanup);

const GROUP: DownstreamImpact = {
  symbol: "applyRateLimit",
  callers: [
    { name: "registerPublicRoutes", file: "src/api/public/webhooks.ts", line: 42 },
    { name: "createUser", file: "src/api/users.ts", line: 118 },
  ],
  endpoints_affected: ["GET /users/:id", "POST /webhooks/stripe"],
  crons_affected: ["job:digest"],
};

function renderGroup(props?: Partial<React.ComponentProps<typeof BlastGroup>>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <BlastGroup
        group={GROUP}
        declaredIn="src/middleware/ratelimit.ts"
        open
        onToggle={() => {}}
        repoFullName="acme/payments-api"
        headSha="abc123"
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("BlastGroup", () => {
  it("names the header after the symbol and shows the declaring file and caller count", () => {
    renderGroup();
    const header = screen.getByRole("button", { name: /applyRateLimit/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(header).toHaveTextContent("declared in src/middleware/ratelimit.ts");
    expect(header).toHaveTextContent("2 callers");
  });

  it("links each caller to the file and line at the given sha", () => {
    renderGroup();
    expect(screen.getByRole("link", { name: "src/api/users.ts:118" })).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/abc123/src/api/users.ts#L118",
    );
  });

  it("renders callers without a link when the repo full name is unknown", () => {
    renderGroup({ repoFullName: null });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("src/api/users.ts:118")).toBeInTheDocument();
  });

  it("keeps endpoints and crons in separate labelled rows", () => {
    renderGroup();
    const endpoints = within(screen.getByRole("group", { name: "Endpoints affected" }));
    const crons = within(screen.getByRole("group", { name: "Crons and jobs affected" }));
    expect(endpoints.getByText("GET /users/:id")).toBeInTheDocument();
    expect(endpoints.queryByText("job:digest")).toBeNull();
    expect(crons.getByText("job:digest")).toBeInTheDocument();
  });

  it("omits an empty chip row and hides the body when closed", () => {
    renderGroup({ group: { ...GROUP, crons_affected: [] }, open: false });
    expect(screen.queryByRole("group", { name: "Crons and jobs affected" })).toBeNull();
    expect(screen.queryByText("src/api/users.ts:118")).toBeNull();
    expect(screen.getByRole("button", { name: /applyRateLimit/ })).toHaveAttribute("title", "Expand");
  });

  it("calls onToggle when the header is clicked", () => {
    const onToggle = vi.fn();
    renderGroup({ onToggle });
    fireEvent.click(screen.getByRole("button", { name: /applyRateLimit/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

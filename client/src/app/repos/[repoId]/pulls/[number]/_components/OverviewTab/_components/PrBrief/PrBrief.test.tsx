import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrBriefRecord, PrBriefResponse, ReviewRecord } from "@devdigest/shared";
import brief from "../../../../../../../../../../messages/en/brief.json";
import prReview from "../../../../../../../../../../messages/en/prReview.json";
import { ApiError } from "@/lib/api";
import type { BriefMutation } from "./helpers";
import { PrBrief } from "./PrBrief";

afterEach(cleanup);

const RECORD: PrBriefRecord = {
  summary: "Adds a token-bucket rate limiter.",
  risks: [],
  review_focus: [],
  missing_facts: [],
  head_sha: "a1b2c3d4e5f6",
  provider: "openai",
  model: "gpt-4.1",
  input_tokens: 3120,
  tokens_in: 3120,
  tokens_out: 410,
  cost_usd: 0.0094,
  generated_at: "2026-10-02T10:00:00.000Z",
};

const response = (over: Partial<PrBriefResponse> = {}): PrBriefResponse => ({
  brief: RECORD,
  stale: false,
  head_sha: "a1b2c3d4e5f6",
  generating: false,
  ...over,
});

const REVIEW: ReviewRecord = {
  id: "r1",
  pr_id: "p1",
  agent_id: "a",
  run_id: "run",
  agent_name: "Sec",
  kind: "review",
  verdict: "request_changes",
  summary: "review summary, not the brief's",
  score: 42,
  model: "gpt-4.1",
  created_at: "2026-10-02T09:00:00Z",
  findings: (["CRITICAL", "WARNING", "SUGGESTION"] as const).map((severity, i) => ({
    id: `f${i}`,
    severity,
    category: "bug" as const,
    title: "t",
    file: "src/a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "r",
    suggestion: null,
    confidence: 0.9,
    kind: "finding" as const,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  })),
};

const mutate = vi.fn();
const reset = vi.fn();
const idle = (over: Partial<BriefMutation> = {}): BriefMutation => ({
  mutate,
  reset,
  isPending: false,
  isError: false,
  error: null,
  ...over,
});

function renderBrief(props: {
  data?: PrBriefResponse;
  mutation?: BriefMutation;
  reviews?: ReviewRecord[];
}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief, prReview }}>
      <PrBrief
        data={props.data}
        isLoading={false}
        mutation={props.mutation ?? idle()}
        reviews={props.reviews}
      />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  mutate.mockClear();
  reset.mockClear();
});

describe("PrBrief — empty and generating", () => {
  it("AC-1: shows the empty card and Generate calls mutate", () => {
    renderBrief({ data: response({ brief: null }) });
    expect(screen.getByText("No brief yet")).toBeInTheDocument();
    expect(screen.getByText("Generate a Why+Risk brief for this PR.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate brief" }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("AC-12: while the server reports generating there is a spinner, no score, two skeleton cards and a disabled refresh", () => {
    const { container } = renderBrief({
      data: response({ generating: true }),
      reviews: [REVIEW],
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("42")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".skeleton").length).toBe(2 * 7);
    expect(screen.getByRole("button", { name: "Re-run the brief for this PR" })).toBeDisabled();
  });

  it("AC-12 (pending only): a pending POST still shows the skeleton although the server says not generating, with Generate disabled on a first run", () => {
    const { container } = renderBrief({
      data: response({ brief: null, generating: false }),
      mutation: idle({ isPending: true }),
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(container.querySelectorAll(".skeleton").length).toBe(2 * 7);
    expect(screen.getByRole("button", { name: "Generate brief" })).toBeDisabled();
  });

  it("EC-5 precedence: a 409 error while the server reports generating shows only the skeleton, and resets the mutation", () => {
    const { container } = renderBrief({
      data: response({ generating: true }),
      mutation: idle({ isError: true, error: new ApiError("running", 409, "brief_running") }),
    });
    expect(container.querySelectorAll(".skeleton").length).toBe(2 * 7);
    expect(screen.queryByText("Couldn't generate the brief")).not.toBeInTheDocument();
    expect(reset).toHaveBeenCalled();
  });
});

describe("PrBrief — ready", () => {
  it("AC-13: verdict from the latest review, summary from the brief, cost line and tooltip", () => {
    renderBrief({ data: response(), reviews: [REVIEW] });
    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText("3 findings · 1 blockers")).toBeInTheDocument();
    expect(screen.getByText("Adds a token-bucket rate limiter.")).toBeInTheDocument();
    expect(screen.queryByText("review summary, not the brief's")).not.toBeInTheDocument();
    expect(screen.getByText("$0.0094 3.1K→410")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: brief.tooltip })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Re-run the brief for this PR" }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("AC-13: the banner reads the newest `review` record, not a newer summary row, and a dismissed CRITICAL is not a blocker", () => {
    const summaryRow: ReviewRecord = { ...REVIEW, id: "s1", kind: "summary", verdict: "approve", score: 99, findings: [] };
    const dismissed = "2026-10-02T09:30:00Z";
    const review: ReviewRecord = {
      ...REVIEW,
      findings: REVIEW.findings.map((f) => (f.severity === "CRITICAL" ? { ...f, dismissed_at: dismissed } : f)),
    };
    renderBrief({ data: response(), reviews: [summaryRow, review] });
    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText("3 findings")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
    expect(screen.queryByText("99")).not.toBeInTheDocument();
  });

  it("EC-12: with no review there is no verdict and no score", () => {
    renderBrief({ data: response(), reviews: [] });
    expect(screen.getByText("Adds a token-bucket rate limiter.")).toBeInTheDocument();
    expect(screen.queryByText("Request changes")).not.toBeInTheDocument();
    expect(screen.queryByText("PR SCORE")).not.toBeInTheDocument();
  });

  it("shows — for an unknown cost and unknown tokens", () => {
    renderBrief({
      data: response({ brief: { ...RECORD, cost_usd: null, tokens_in: null, tokens_out: null } }),
    });
    expect(screen.getByText("— —")).toBeInTheDocument();
  });

  it("AC-14: a stale brief shows both short SHAs", () => {
    renderBrief({ data: response({ stale: true, head_sha: "9f8e7d6c5b4a" }) });
    expect(screen.getByText("Stale — generated for a1b2c3d, PR now at 9f8e7d6")).toBeInTheDocument();
  });

  it("AC-7: one line per missing fact, with the exact copy", () => {
    renderBrief({
      data: response({
        brief: {
          ...RECORD,
          missing_facts: [
            { fact: "intent", status: "stale", detail: null },
            { fact: "blast", status: "degraded", detail: "index_stale" },
            { fact: "linked_issue", status: "missing_token", detail: "42" },
          ],
        },
      }),
    });
    expect(screen.getByText("Missing or trimmed inputs")).toBeInTheDocument();
    expect(screen.getByText("Intent: derived for an older commit.")).toBeInTheDocument();
    expect(screen.getByText("Blast radius: degraded — the index is stale.")).toBeInTheDocument();
    expect(
      screen.getByText("Linked issue #42: not retrieved — no GitHub token configured."),
    ).toBeInTheDocument();
  });
});

describe("PrBrief — error", () => {
  it("EC-3: names the failure and Retry calls mutate; a stored brief keeps rendering below", () => {
    renderBrief({
      data: response(),
      mutation: idle({
        isError: true,
        error: new ApiError("bad", 502, "brief_failed", { reason: "invalid_output" }),
      }),
    });
    expect(screen.getByText("Couldn't generate the brief")).toBeInTheDocument();
    expect(screen.getByText("The model's answer did not match the brief format.")).toBeInTheDocument();
    expect(screen.getByText("Adds a token-bucket rate limiter.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("EC-10: no changed files asks the user to reload the PR", () => {
    renderBrief({
      data: response({ brief: null }),
      mutation: idle({ isError: true, error: new ApiError("none", 422, "no_changed_files") }),
    });
    expect(screen.getByText(/reload the PR and try again/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("EC-4: a missing key names the provider and links to Settings", () => {
    renderBrief({
      data: response({ brief: null }),
      mutation: idle({
        isError: true,
        error: new ApiError("no key", 422, "provider_key_missing", { provider: "openai" }),
      }),
    });
    expect(screen.getByText(/No API key is configured for openai\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Settings → API Keys" })).toHaveAttribute(
      "href",
      "/settings/api-keys",
    );
  });
});

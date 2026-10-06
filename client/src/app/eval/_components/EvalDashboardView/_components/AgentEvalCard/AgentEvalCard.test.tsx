import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalAgentCard } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/eval.json";
import { AgentEvalCard } from "./AgentEvalCard";

afterEach(cleanup);

const card = (running: boolean): EvalAgentCard => ({
  agent_id: "ag1",
  agent_name: "Security Reviewer",
  provider: "openai",
  model: "gpt-4.1",
  enabled: true,
  running,
  cases_total: 4,
  latest: null,
});

const renderCard = (c: EvalAgentCard) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <AgentEvalCard card={c} />
    </NextIntlClientProvider>,
  );

describe("AgentEvalCard", () => {
  it("AC-9: shows a Running badge, as text, while the agent has a run in flight — and not otherwise", () => {
    renderCard(card(true));
    expect(screen.getByText("Running")).toBeInTheDocument();
    cleanup();

    renderCard(card(false));
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
    expect(screen.getByText("Not run yet")).toBeInTheDocument();
  });
});

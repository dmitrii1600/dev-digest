import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

/**
 * MermaidDiagram — the renderer behind the Onboarding Tour's Architecture overview
 * (spec EC-7 / AC-9, "diagram parsed with strict security, omitted when invalid").
 * `ArchitectureOverview.test.tsx` stubs this component, so nothing else pins the
 * real validation: model-written text that is not a parseable diagram must leave NO
 * element behind (no empty box, no mermaid "Syntax error" graphic), and a valid one
 * must be rendered under `securityLevel: "strict"`. The `mermaid` package is mocked —
 * jsdom cannot lay out SVG, and the contract under test is how we drive it.
 */

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
}));
vi.mock("mermaid", () => ({ default: mermaid }));

import { MermaidDiagram } from "./MermaidDiagram";

beforeEach(() => {
  mermaid.initialize.mockReset();
  mermaid.parse.mockReset().mockResolvedValue(true);
  mermaid.render.mockReset().mockResolvedValue({ svg: '<svg data-testid="graph"></svg>' });
});
afterEach(cleanup);

describe("MermaidDiagram", () => {
  it("renders a parseable diagram as SVG, initialised with strict security and parse-before-render", async () => {
    render(<MermaidDiagram chart={"flowchart LR\nA-->B"} />);
    expect(await screen.findByTestId("graph")).toBeInTheDocument();
    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: "strict" }));
    expect(mermaid.parse).toHaveBeenCalledWith("flowchart LR\nA-->B", { suppressErrors: true });
    expect(mermaid.parse.mock.invocationCallOrder[0]!).toBeLessThan(mermaid.render.mock.invocationCallOrder[0]!);
  });

  it("renders nothing — no empty box, no error graphic — for text that is not a diagram, without touching mermaid", async () => {
    const { container } = render(<MermaidDiagram chart={"This service talks to a database."} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(mermaid.parse).not.toHaveBeenCalled();
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it("renders nothing when a diagram-looking string does not parse, and never calls render", async () => {
    mermaid.parse.mockResolvedValue(false);
    const { container } = render(<MermaidDiagram chart={"flowchart LR\nA --> ("} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it("renders nothing when mermaid throws", async () => {
    mermaid.parse.mockRejectedValue(new Error("boom"));
    const { container } = render(<MermaidDiagram chart={"graph TD\nA-->B"} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

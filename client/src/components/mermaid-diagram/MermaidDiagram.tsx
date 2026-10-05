"use client";

import React from "react";

let seq = 0;

/** Mermaid diagrams must start with a known graph keyword. Anything else
 *  (prose, JSON like {"type":"Buffer"...}, empty) is not a diagram → skip. */
const MERMAID_RE =
  /^\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|C4Context)\b/;

function looksLikeMermaid(src: string): boolean {
  return MERMAID_RE.test(src.trim());
}

/** The header of a left-to-right (or right-to-left) flowchart. */
const HORIZONTAL_RE = /^\s*(flowchart|graph)\s+(LR|RL)\b/;

/** The rendered SVG's natural width, from its viewBox (0 when absent). */
function svgWidth(svg: string): number {
  const box = /viewBox="[-\d.]+\s+[-\d.]+\s+([\d.]+)/.exec(svg);
  return box ? Number(box[1]) : 0;
}

/**
 * Renders a mermaid diagram string to inline SVG. mermaid is imported lazily
 * (client-only). We VALIDATE with mermaid.parse({suppressErrors}) before
 * rendering — mermaid otherwise injects a "Syntax error" bomb graphic into the
 * DOM on bad input instead of throwing. Junk/unparseable input renders nothing.
 */
export function MermaidDiagram({
  chart,
  className,
  theme = "dark",
  themeVariables,
  flowchart,
  stackWhenWide = false,
  frameStyle,
}: {
  chart: string;
  /** Hook for scoped CSS that restyles the rendered SVG (e.g. with theme tokens). */
  className?: string;
  /** mermaid theme; `base` + `themeVariables` when the caller styles the SVG itself. */
  theme?: "dark" | "base" | "neutral" | "default";
  themeVariables?: Record<string, string>;
  /** Per-diagram-type overrides, e.g. `{ useMaxWidth: false }` to keep the natural size. */
  flowchart?: Record<string, string | number | boolean>;
  /** Re-lay a `flowchart LR|RL` top-down when it is wider than its column. */
  stackWhenWide?: boolean;
  /** Overrides for the frame around the SVG (background, border, padding). */
  frameStyle?: React.CSSProperties;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [state, setState] = React.useState<"pending" | "ok" | "invalid">("pending");
  // Primitive key so a caller passing a fresh object each render does not re-render the diagram.
  const varsKey = themeVariables ? JSON.stringify(themeVariables) : "";
  const flowKey = flowchart ? JSON.stringify(flowchart) : "";

  React.useEffect(() => {
    let cancelled = false;
    const src = (chart ?? "").trim();
    if (!looksLikeMermaid(src)) {
      setState("invalid");
      return;
    }
    setState("pending");
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme,
          securityLevel: "strict",
          ...(varsKey ? { themeVariables: JSON.parse(varsKey) as Record<string, string> } : {}),
          ...(flowKey ? { flowchart: JSON.parse(flowKey) as Record<string, string | number | boolean> } : {}),
        });
        // parse first; suppressErrors → returns false (no throw, no DOM bomb).
        const valid = await mermaid.parse(src, { suppressErrors: true });
        if (cancelled) return;
        if (!valid) {
          setState("invalid");
          return;
        }
        let { svg } = await mermaid.render(`dd-mermaid-${seq++}`, src);
        // A left-to-right flowchart wider than its column is shrunk to unreadable
        // labels; stacking it top-down usually fits. Measured on the parent,
        // because this frame is still hidden (display: none) while pending.
        // minus the frame's padding and border
        const room = (ref.current?.parentElement?.clientWidth ?? 0) - 40;
        if (stackWhenWide && room > 0 && svgWidth(svg) > room && HORIZONTAL_RE.test(src)) {
          ({ svg } = await mermaid.render(`dd-mermaid-${seq++}`, src.replace(HORIZONTAL_RE, "$1 TD")));
        }
        if (cancelled) return;
        if (ref.current) ref.current.innerHTML = svg;
        setState("ok");
      } catch {
        if (!cancelled) setState("invalid");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, theme, varsKey, flowKey, stackWhenWide]);

  // Not a (valid) diagram → render nothing rather than a broken box.
  if (state === "invalid") return null;

  return (
    <div
      ref={ref}
      className={className}
      style={{
        display: state === "ok" ? "flex" : "none",
        justifyContent: "center",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 12,
        overflowX: "auto",
        ...frameStyle,
      }}
    />
  );
}

export default MermaidDiagram;

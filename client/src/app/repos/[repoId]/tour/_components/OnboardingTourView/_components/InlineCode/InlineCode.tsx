/* InlineCode — model text with `backtick` spans shown as inline code, the way
   the design's mdLite does. Everything stays a React text node: no HTML is
   parsed, so untrusted model text cannot inject markup. */
import type { CSSProperties } from "react";

const s = {
  code: {
    fontSize: "0.92em",
    padding: "1px 5px",
    borderRadius: 4,
    background: "var(--accent-bg)",
    color: "var(--accent-text)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
};

export function InlineCode({ text }: { text: string }) {
  // split with a capture group: odd indexes are the backtick contents
  const parts = text.split(/`([^`\n]+)`/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="mono" style={s.code}>
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

"use client";

import React from "react";
import type { FindingRecord, Severity } from "@devdigest/shared";
import { clampLeft } from "./FindingsPreviewCard";

/** Most severe first — the order every findings preview lists in. */
const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

/**
 * Sort findings most-severe-first, without mutating the caller's array.
 *
 * Shared so the PR list and the run timeline order their previews identically —
 * two sorts that merely happen to agree is one refactor away from not agreeing.
 */
export function sortBySeverity(findings: FindingRecord[]): FindingRecord[] {
  return [...findings].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9),
  );
}

/** Gap the pointer has to cross between the trigger and the card, in ms. */
const CLOSE_DELAY_MS = 120;

export interface PreviewAnchor {
  top: number;
  left: number;
}

/**
 * Hover state for a findings preview card: where to put it, and when to let it
 * go.
 *
 * The card is rendered `position: fixed` (it has to be — see FindingsPreviewCard),
 * so it cannot simply sit inside the hovered element and inherit its hover. That
 * leaves a real gap between trigger and card, and closing on `mouseleave` would
 * snatch the card away as the pointer crosses it. Hence the grace period, and
 * hence `cancelClose` being exposed for the card's own `onMouseEnter`.
 *
 * Shared by the PR list and the run timeline. Both need the same timer, and a
 * timer that must be cleared on unmount is exactly the thing not to have two
 * copies of.
 */
export function useFindingsPreview() {
  const [anchor, setAnchor] = React.useState<PreviewAnchor | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  /** Anchor the card just below `el`, clamped to stay on screen. */
  const open = React.useCallback(
    (el: HTMLElement) => {
      cancelClose();
      const r = el.getBoundingClientRect();
      setAnchor({ top: r.bottom + 6, left: clampLeft(r.left, window.innerWidth) });
    },
    [cancelClose],
  );

  const scheduleClose = React.useCallback(
    (onClosed?: () => void) => {
      cancelClose();
      timer.current = setTimeout(() => {
        setAnchor(null);
        onClosed?.();
      }, CLOSE_DELAY_MS);
    },
    [cancelClose],
  );

  React.useEffect(() => cancelClose, [cancelClose]);

  return { anchor, open, scheduleClose, cancelClose, isOpen: anchor != null };
}

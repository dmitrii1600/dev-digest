/* useActiveSection — scroll-spy for the "On this page" list. The active section
   is the first one, in display order, that overlaps the upper band of the
   viewport. Picking a section makes it active at once and holds it while the
   smooth scroll settles, so the observer cannot snap back to the section the
   scroll passes through (or to the one above a short last section). */
"use client";

import React from "react";
import type { OnboardingSectionId } from "@devdigest/shared";

/** Band the section must overlap: below the sticky top bar, above the lower 60%. */
const ROOT_MARGIN = "-80px 0px -60% 0px";
/** How long a picked section wins over the observer (smooth scroll duration). */
const HOLD_MS = 900;

export function useActiveSection(ids: readonly OnboardingSectionId[], enabled: boolean) {
  const [active, setActive] = React.useState<OnboardingSectionId | undefined>(ids[0]);
  const holdUntil = React.useRef(0);

  React.useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") return;
    const visible = new Set<OnboardingSectionId>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = e.target.id.replace(/^tour-/, "") as OnboardingSectionId;
          if (e.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        if (Date.now() < holdUntil.current) return;
        const first = ids.find((id) => visible.has(id));
        if (first) setActive(first);
      },
      { rootMargin: ROOT_MARGIN },
    );
    for (const id of ids) {
      const el = document.getElementById(`tour-${id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids, enabled]);

  const pick = React.useCallback((id: OnboardingSectionId) => {
    holdUntil.current = Date.now() + HOLD_MS;
    setActive(id);
  }, []);

  return [active, pick] as const;
}

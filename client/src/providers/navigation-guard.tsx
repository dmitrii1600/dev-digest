/* navigation-guard.tsx — a page with unsaved work registers a blocker message;
   while one is set, same-origin link clicks, `confirmLeave()` calls (the shell's
   programmatic `router.push` sites) and reload / tab close ask first. Back and
   Forward are not guarded (no reliable hook in the App Router). Without a
   provider the default context is a no-op, so shell hooks render anywhere. */
"use client";

import React from "react";

interface NavigationGuard {
  /** Set the "leave and discard?" message, or `null` to clear the blocker. */
  setBlocker: (message: string | null) => void;
  /** `true` when there is no blocker or the user accepts the confirm. */
  confirmLeave: () => boolean;
}

const NOOP_GUARD: NavigationGuard = { setBlocker: () => {}, confirmLeave: () => true };

const GuardCtx = React.createContext<NavigationGuard>(NOOP_GUARD);

/** True for a plain, same-origin, new-URL link click that would navigate in-app. */
function isLeavingClick(e: MouseEvent): HTMLAnchorElement | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const el = e.target instanceof Element ? e.target.closest("a[href]") : null;
  if (!(el instanceof HTMLAnchorElement)) return null;
  if ((el.target && el.target !== "_self") || el.hasAttribute("download")) return null;
  let next: URL;
  try {
    next = new URL(el.href, window.location.href);
  } catch {
    return null;
  }
  if (next.origin !== window.location.origin) return null;
  // A hash-only change stays on the same page, so nothing is lost.
  if (next.pathname === window.location.pathname && next.search === window.location.search) return null;
  return el;
}

export function NavigationGuardProvider({ children }: { children: React.ReactNode }) {
  const messageRef = React.useRef<string | null>(null);
  const [active, setActive] = React.useState(false);

  const setBlocker = React.useCallback((message: string | null) => {
    messageRef.current = message;
    setActive(message !== null);
  }, []);

  const confirmLeave = React.useCallback(() => {
    const message = messageRef.current;
    return message === null ? true : window.confirm(message);
  }, []);

  React.useEffect(() => {
    if (!active) return;
    const onClick = (e: MouseEvent) => {
      if (!isLeavingClick(e)) return;
      if (!confirmLeave()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [active, confirmLeave]);

  const value = React.useMemo(() => ({ setBlocker, confirmLeave }), [setBlocker, confirmLeave]);
  return <GuardCtx.Provider value={value}>{children}</GuardCtx.Provider>;
}

export function useNavigationGuard(): NavigationGuard {
  return React.useContext(GuardCtx);
}

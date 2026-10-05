import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup, renderHook, act } from "@testing-library/react";
import { NavigationGuardProvider, useNavigationGuard } from "./navigation-guard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Harness({ message }: { message: string | null }) {
  const { setBlocker } = useNavigationGuard();
  React.useEffect(() => {
    setBlocker(message);
  }, [setBlocker, message]);
  return (
    <div>
      <a href="/other">other</a>
      <a href="/#section">hash</a>
      <a href="/new-tab" target="_blank">
        blank
      </a>
    </div>
  );
}

function renderGuarded(message: string | null) {
  return render(
    <NavigationGuardProvider>
      <Harness message={message} />
    </NavigationGuardProvider>,
  );
}

/** fireEvent returns false when the event was default-prevented. */
const click = (el: HTMLElement) => fireEvent.click(el);

describe("NavigationGuardProvider", () => {
  it("does not intercept anything without a blocker", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderGuarded(null);
    expect(click(screen.getByText("other"))).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it("asks before an in-app link and honours the answer", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderGuarded("Leave?");
    expect(click(screen.getByText("other"))).toBe(false);
    expect(confirm).toHaveBeenCalledWith("Leave?");
    confirm.mockReturnValue(true);
    expect(click(screen.getByText("other"))).toBe(true);
  });

  it("never intercepts a hash link or a new-tab link", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderGuarded("Leave?");
    expect(click(screen.getByText("hash"))).toBe(true);
    expect(click(screen.getByText("blank"))).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("default-prevents beforeunload only while a blocker is set, and removes both listeners after", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const view = renderGuarded("Leave?");
    const blocked = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(true);

    view.rerender(
      <NavigationGuardProvider>
        <Harness message={null} />
      </NavigationGuardProvider>,
    );
    const free = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(free);
    expect(free.defaultPrevented).toBe(false);
    expect(click(screen.getByText("other"))).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("confirmLeave returns true with no provider", () => {
    const { result } = renderHook(() => useNavigationGuard());
    expect(result.current.confirmLeave()).toBe(true);
  });

  it("confirmLeave asks through window.confirm while a blocker is set", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result } = renderHook(() => useNavigationGuard(), { wrapper: NavigationGuardProvider });
    expect(result.current.confirmLeave()).toBe(true);
    act(() => result.current.setBlocker("Leave?"));
    expect(result.current.confirmLeave()).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});

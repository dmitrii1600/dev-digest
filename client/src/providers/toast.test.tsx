/**
 * ToastProvider — the `notify` bridge and the auto-dismiss window. The PR
 * Brief's "File not in this PR's diff" notice (EC-6) is a `notify.info` call
 * that "disappears after 4 seconds"; `use-brief-jump.test.tsx` pins the call,
 * this file pins that the real provider shows it and removes it at 4 s, so a
 * change to the timeout turns exactly this test red.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { ToastProvider, notify } from "./toast";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ToastProvider", () => {
  it("shows a notify.info message and removes it after 4 seconds, not before", () => {
    render(<ToastProvider>{null}</ToastProvider>);
    act(() => notify.info("File not in this PR's diff"));
    expect(screen.getByText("File not in this PR's diff")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(screen.getByText("File not in this PR's diff")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("File not in this PR's diff")).not.toBeInTheDocument();
  });

  it("notify is a no-op, not a throw, when no provider is mounted", () => {
    expect(() => notify.info("nobody listens")).not.toThrow();
  });
});

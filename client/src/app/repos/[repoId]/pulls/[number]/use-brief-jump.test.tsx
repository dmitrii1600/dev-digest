import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import brief from "../../../../../../messages/en/brief.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams("trace=r1"),
}));
const info = vi.hoisted(() => vi.fn());
vi.mock("@/providers/toast", () => ({ notify: { info } }));

import { useBriefJump } from "./use-brief-jump";

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={{ brief }}>
    {children}
  </NextIntlClientProvider>
);

function jumpFor(diffPaths: string[]) {
  const { result } = renderHook(() => useBriefJump({ repoId: "r", number: "482", diffPaths }), {
    wrapper,
  });
  return result.current;
}

afterEach(() => {
  cleanup();
  push.mockClear();
  info.mockClear();
});

describe("useBriefJump", () => {
  it("pushes the Files changed URL for a changed file, keeping trace, without a notice", () => {
    jumpFor(["src/a.ts"])("src/a.ts:12");
    expect(push).toHaveBeenCalledTimes(1);
    const url = push.mock.calls[0]![0] as string;
    expect(url.startsWith("/repos/r/pulls/482?")).toBe(true);
    expect(url).toContain("tab=diff");
    expect(url).toContain("file=src%2Fa.ts");
    expect(url).toContain("line=12");
    expect(url).toContain("trace=r1");
    expect(info).not.toHaveBeenCalled();
  });

  it("a blast-map-only file stays on Overview and says it is not in the diff (EC-6)", () => {
    jumpFor(["src/a.ts"])("src/server.ts:31");
    expect(info).toHaveBeenCalledWith("File not in this PR's diff");
    expect(push).not.toHaveBeenCalled();
  });

  it("treats a case variant as not in the diff", () => {
    jumpFor(["src/a.ts"])("Src/a.ts:1");
    expect(push).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api";
import { evalStatusForError } from "./helpers";

/**
 * What the FindingCard says after a failed "Turn into eval case". Only the 422
 * `diff_too_large` answer (EC-12) gets its own sentence; a 422 for another reason,
 * a 404 (EC-3) and a network failure all read as the generic failure — they must
 * not be mistaken for "too large".
 */
describe("evalStatusForError", () => {
  it("names a diff over the freeze cap", () => {
    const err = new ApiError("too big", 422, "eval_case_rejected", { reason: "diff_too_large" });
    expect(evalStatusForError(err)).toBe("too_large");
  });

  it("keeps every other failure generic", () => {
    expect(evalStatusForError(new ApiError("x", 422, "eval_case_rejected", { reason: "finding_undecided" }))).toBe(
      "error",
    );
    expect(evalStatusForError(new ApiError("x", 422, "eval_case_rejected"))).toBe("error");
    expect(evalStatusForError(new ApiError("x", 404, "not_found", { reason: "diff_too_large" }))).toBe("error");
    expect(evalStatusForError(new Error("network down"))).toBe("error");
    expect(evalStatusForError(undefined)).toBe("error");
  });
});

/* expectation-json — the editor's "expected output" JSON panel. It mirrors the form fields:
   exactly `{ type, file, start_line, end_line }`, two-space JSON in that key order. The API
   takes `expectation` + `target` as fields, so the 8 KB cap and the shape rule live here only.
   `start_line > end_line` is deliberately NOT a shape error: it flows to the form, where the
   target check names it. */
import { EVAL_CASE_LIMITS, EvalExpectation } from "@devdigest/shared";
import { utf8Bytes } from "./case-diff";

export interface ExpectationDraft {
  type: EvalExpectation;
  file: string;
  start_line: number;
  end_line: number;
}

export type ExpectationJson =
  | { ok: true; value: ExpectationDraft }
  | { ok: false; reason: "too_large" | "parse" | "shape" };

const KEYS = ["type", "file", "start_line", "end_line"] as const;

export function formatExpectationJson(d: ExpectationDraft): string {
  return JSON.stringify({ type: d.type, file: d.file, start_line: d.start_line, end_line: d.end_line }, null, 2);
}

const isLine = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;

export function parseExpectationJson(text: string): ExpectationJson {
  if (utf8Bytes(text) > EVAL_CASE_LIMITS.expectedJsonBytes) return { ok: false, reason: "too_large" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "parse" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false, reason: "shape" };
  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== KEYS.length || !KEYS.every((k) => k in obj)) return { ok: false, reason: "shape" };
  const type = EvalExpectation.safeParse(obj.type);
  if (!type.success || typeof obj.file !== "string" || !isLine(obj.start_line) || !isLine(obj.end_line)) {
    return { ok: false, reason: "shape" };
  }
  return { ok: true, value: { type: type.data, file: obj.file, start_line: obj.start_line, end_line: obj.end_line } };
}

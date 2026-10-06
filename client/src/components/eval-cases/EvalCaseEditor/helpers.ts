import { EvalCaseInput, EVAL_CASE_LIMITS, type EvalCase, type EvalExpectation } from "@devdigest/shared";
import { overlapsChanged, utf8Bytes, type PastedDiff } from "../case-diff";

/** What the editor holds while a case is being written. Line numbers stay text while typed. */
export interface Draft {
  name: string;
  diff: string;
  title: string;
  body: string;
  expectation: EvalExpectation;
  file: string;
  start: string;
  end: string;
}

export const EMPTY_DRAFT: Draft = {
  name: "",
  diff: "",
  title: "",
  body: "",
  expectation: "must_find",
  file: "",
  start: "1",
  end: "1",
};

export function draftFromCase(c: EvalCase): Draft {
  return {
    name: c.name,
    diff: c.input_diff,
    title: c.input_meta.pr_title,
    body: c.input_meta.pr_body,
    expectation: c.expectation,
    file: c.target.file,
    start: String(c.target.start_line),
    end: String(c.target.end_line),
  };
}

export function sameDraft(a: Draft, b: Draft): boolean {
  return (Object.keys(a) as (keyof Draft)[]).every((k) => a[k] === b[k]);
}

/** The request body. The name is sent as typed; the server trims it. */
export function inputFromDraft(d: Draft): EvalCaseInput {
  return {
    name: d.name,
    input_diff: d.diff,
    input_meta: { pr_title: d.title, pr_body: d.body },
    expectation: d.expectation,
    target: { file: d.file, start_line: Number(d.start), end_line: Number(d.end) },
  };
}

/** One problem, shown next to its field. `key` is under `eval.json` → `caseEditor`. */
export interface DraftError {
  field: "name" | "diff" | "title" | "body" | "target";
  key: string;
  values?: Record<string, string | number>;
}

const isLine = (s: string): boolean => /^\d+$/.test(s.trim()) && Number(s) >= 1;

/** The same trim + lowercase key the server compares case names by. */
export const nameKey = (name: string): string => name.trim().toLowerCase();

/**
 * Every reason Save is blocked. Shape and size rules come from the `EvalCaseInput` contract the
 * route validates with; the diff, target and name-clash rules are the server's (EC-1 … EC-5).
 * `ownName` is the name of a case this editor just created: the parent's list may already hold it.
 */
export function draftErrors(
  draft: Draft,
  parsed: PastedDiff,
  takenNames: readonly string[],
  ownName?: string,
): DraftError[] {
  const errors: DraftError[] = [];
  const add = (e: DraftError) => {
    if (!errors.some((x) => x.field === e.field)) errors.push(e);
  };

  const shape = EvalCaseInput.safeParse(inputFromDraft(draft));
  if (!shape.success) {
    for (const issue of shape.error.issues) {
      const path = issue.path.join(".");
      if (path === "name") {
        add({ field: "name", key: draft.name.trim() === "" ? "nameRequired" : "nameTooLong" });
      } else if (path === "input_meta.pr_title") {
        add({ field: "title", key: "titleTooLong" });
      } else if (path === "input_meta.pr_body") {
        add({ field: "body", key: "bodyTooLarge" });
      } else if (path === "target.start_line" && issue.code === "custom") {
        add({ field: "target", key: "targetStartAfterEnd" });
      } else if (path.startsWith("target.") && path !== "target.file") {
        add({ field: "target", key: "targetLinesInvalid" });
      }
    }
  }

  const bytes = utf8Bytes(draft.diff);
  if (bytes > EVAL_CASE_LIMITS.diffBytes) {
    add({ field: "diff", key: "diffTooLarge", values: { bytes } });
  } else if (!parsed.ok) {
    add({ field: "diff", key: parsed.reason === "needs_git_headers" ? "diffNeedsGitHeaders" : "diffInvalid" });
  }

  if (errors.every((e) => e.field !== "name")) {
    const key = nameKey(draft.name);
    const own = ownName === undefined ? -1 : takenNames.findIndex((n) => nameKey(n) === nameKey(ownName));
    if (takenNames.some((n, i) => i !== own && nameKey(n) === key)) add({ field: "name", key: "nameTaken" });
  }

  if (parsed.ok && !errors.some((e) => e.field === "target")) {
    const file = parsed.files.find((f) => f.path === draft.file);
    if (!file) {
      add({ field: "target", key: "targetFileMissing", values: { file: draft.file || "—" } });
    } else if (isLine(draft.start) && isLine(draft.end) && !overlapsChanged(file, Number(draft.start), Number(draft.end))) {
      add({
        field: "target",
        key: "targetNoOverlap",
        values: { start: Number(draft.start), end: Number(draft.end), file: file.path },
      });
    }
  }
  return errors;
}

/** Has the expectation type or target moved off the saved case (EC-12)? */
export function targetChanged(a: Draft, b: Draft): boolean {
  return a.expectation !== b.expectation || a.file !== b.file || a.start !== b.start || a.end !== b.end;
}

/** `eval.json` → `caseEditor` key for each reason the expectation JSON is rejected. */
export const JSON_ERROR_KEY = {
  too_large: "jsonTooLarge",
  parse: "jsonParseError",
  shape: "jsonShapeError",
} as const;

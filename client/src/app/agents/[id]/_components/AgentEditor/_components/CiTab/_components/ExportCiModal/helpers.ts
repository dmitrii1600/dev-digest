import { parse } from "yaml";
import { CI_MAX_BYTES } from "@devdigest/shared";

export type WorkflowCheck =
  | { ok: true }
  | { ok: false; reason: "too_large" }
  | { ok: false; reason: "yaml"; error: string };

/** Client mirror of the server's workflow check: ≤ 64 KiB (bytes) and parses as YAML. */
export function validateWorkflow(text: string): WorkflowCheck {
  if (new TextEncoder().encode(text).length > CI_MAX_BYTES) {
    return { ok: false, reason: "too_large" };
  }
  try {
    parse(text);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "yaml", error: e instanceof Error ? e.message : String(e) };
  }
}

/** Save a base64 zip through a temporary object URL. */
export function downloadZip(base64: string, fileName: string): void {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** `devdigest-ci-<owner>-<name>.zip`, safe for a file name. */
export function zipFileName(repo: string): string {
  return `devdigest-ci-${repo.replace(/[^A-Za-z0-9_.-]+/g, "-")}.zip`;
}

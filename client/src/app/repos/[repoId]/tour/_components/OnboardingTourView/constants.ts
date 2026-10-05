/** Constants for the Onboarding Tour page. */
import type { OnboardingSectionId } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

/** The five sections, in display order (AC-2). Titles come from `sections.<id>`. */
export const SECTIONS: { id: OnboardingSectionId; icon: IconName }[] = [
  { id: "architecture", icon: "Boxes" },
  { id: "critical_paths", icon: "Activity" },
  { id: "run_locally", icon: "Command" },
  { id: "reading_path", icon: "ListChecks" },
  { id: "first_tasks", icon: "Target" },
];

/** Error codes that map to one message (i18n key under `onboarding`). */
export const ERROR_COPY: Record<string, string> = {
  repo_not_cloned: "errors.repo_not_cloned",
  generation_running: "errors.generation_running",
  provider_key_missing: "errors.provider_key_missing",
};

/** Error codes whose copy depends on `details.reason`: code → { base key, known reasons }. */
export const REASON_ERROR_COPY: Record<string, { base: string; reasons: readonly string[] }> = {
  repo_not_indexed: {
    base: "errors.repo_not_indexed",
    reasons: ["flag_off", "never_indexed", "index_failed", "no_ranked_files"],
  },
  generation_failed: {
    base: "errors.generation_failed",
    reasons: ["timeout", "invalid_output", "llm_error"],
  },
};

export const UNKNOWN_ERROR_KEY = "errors.unknown";

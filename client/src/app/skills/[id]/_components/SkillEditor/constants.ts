import type { IconName } from "@devdigest/ui";

/** Tabs valid in the `?tab=` query string — anything else falls back to "config". */
export const VALID_TABS: string[] = ["config", "preview", "versions", "stats"];

/** Editor tab descriptor. `labelKey` resolves under the `skills` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "preview", labelKey: "editor.tabs.preview", icon: "Eye" },
  { key: "versions", labelKey: "editor.tabs.versions", icon: "History" },
  { key: "stats", labelKey: "editor.tabs.stats", icon: "BarChart" },
];

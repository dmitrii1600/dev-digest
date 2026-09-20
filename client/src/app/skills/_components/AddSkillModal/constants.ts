import type { IconName } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";

export const MODAL_WIDTH = 720;

/** The three ways a skill enters the lab; `labelKey` reads `skills.drawer.tabs.*`. */
export type AddSkillTab = "create" | "file" | "url";
export const ADD_SKILL_TABS: readonly { key: AddSkillTab; labelKey: `drawer.tabs.${AddSkillTab}`; icon: IconName }[] = [
  { key: "create", labelKey: "drawer.tabs.create", icon: "Edit" },
  { key: "file", labelKey: "drawer.tabs.file", icon: "Upload" },
  { key: "url", labelKey: "drawer.tabs.url", icon: "Link" },
];

/** A hand-typed or imported skill is "custom" until the author says otherwise. */
export const DEFAULT_TYPE: SkillType = "custom";

import type { SkillSource } from "@devdigest/shared";
import { UNTRUSTED_SOURCES } from "./constants";

export function isUntrustedSource(source: SkillSource): boolean {
  return UNTRUSTED_SOURCES.includes(source);
}

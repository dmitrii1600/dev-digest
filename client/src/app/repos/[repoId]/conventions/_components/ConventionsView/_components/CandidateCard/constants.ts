import type { ConventionCategory } from "@devdigest/shared";

/** The category enum, in the order the edit dropdown lists it (mirrors the contract). */
export const CATEGORIES: readonly ConventionCategory[] = [
  "naming",
  "structure",
  "imports",
  "typing",
  "async",
  "error_handling",
  "testing",
  "api",
  "style",
  "other",
];

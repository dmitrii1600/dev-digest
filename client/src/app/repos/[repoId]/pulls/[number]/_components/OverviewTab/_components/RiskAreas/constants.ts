import { SEV, type IconName } from "@devdigest/ui";
import type { RiskSeverity } from "@devdigest/shared";

/** Risk kind → icon. An unknown kind (the model may say anything) gets the generic one. */
export const KIND_ICON: Record<string, IconName> = {
  security: "Shield",
  db_migration: "Database",
  breaking_api: "AlertOctagon",
  perf: "Zap",
  deps: "Boxes",
};
export const GENERIC_KIND_ICON: IconName = "AlertTriangle";

/** Severity colour — from the shared `SEV` map, never a local palette. */
export const SEVERITY_COLOR: Record<RiskSeverity, string> = {
  high: SEV.CRITICAL.c,
  medium: SEV.WARNING.c,
  low: SEV.INFO.c,
};

import { useTranslations } from "next-intl";
import { relativeTime } from "./helpers";

/** Localised "3h ago" for an ISO timestamp; "—" when absent or unparseable. */
export function useRelativeTime(): (iso: string | null | undefined) => string {
  const t = useTranslations("ci");
  return (iso) => {
    const r = relativeTime(iso);
    return r ? t(`runs.ago.${r.unit}`, { count: r.count }) : "—";
  };
}

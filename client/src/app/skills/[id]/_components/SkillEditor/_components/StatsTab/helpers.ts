import type { DonutSegment } from "@devdigest/ui";
import { CATEGORY_PALETTE } from "./constants";

/** `accept_rate` is `null` when nothing has been accepted or dismissed yet —
 *  render "—", never "0%", so an unreviewed skill doesn't read as "reviewed
 *  and rejected every time." */
export function formatAcceptRate(rate: number | null): string {
  return rate == null ? "—" : `${Math.round(rate * 100)}%`;
}

export function toDonutSegments(byCategory: { category: string; count: number }[]): DonutSegment[] {
  return byCategory.map((c, i) => ({
    label: c.category,
    value: c.count,
    color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]!,
  }));
}

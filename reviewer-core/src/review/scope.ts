import type { Finding } from '@devdigest/shared';

/**
 * The scope filter — a new pure module, applied AFTER `groundFindings`, not
 * inside it. `grounding.ts` is never opened: the grounding string and the
 * "score from survivors" rule keep exactly their current meaning, and this
 * gate runs strictly downstream of it.
 *
 * The ONE rule: drop a finding when the reviewer itself labelled it
 * `out_of_scope` AND its severity is not `CRITICAL`. `in_scope`, `unclear`,
 * `null` and `undefined` are all kept — an absent or undecided label never
 * loses a finding. An `out_of_scope` CRITICAL is ALWAYS kept: this is the
 * whole defence against a PR description crafted to talk a reviewer out of a
 * real vulnerability (CamoLeak, CVE-2025-59145; the Checkmarx Claude Code
 * red-team documents the same pattern). The worst this filter can ever do is
 * suppress a non-critical finding — never a CRITICAL, and every drop is
 * reported so it is never silent.
 */
export function filterByScope(findings: Finding[]): {
  kept: Finding[];
  dropped: { finding: Finding; reason: string }[];
} {
  const kept: Finding[] = [];
  const dropped: { finding: Finding; reason: string }[] = [];
  for (const f of findings) {
    if (f.scope === 'out_of_scope' && f.severity !== 'CRITICAL') {
      dropped.push({ finding: f, reason: 'labelled out_of_scope by the derived intent' });
    } else {
      kept.push(f);
    }
  }
  return { kept, dropped };
}

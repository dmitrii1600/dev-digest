import type { SkillSecurityFinding, SkillSecurityReport } from '@devdigest/shared';

/**
 * Heuristic prompt-injection scan for IMPORTED skill bodies (ring 2 — pure,
 * no I/O). It is a vetting gate at import/enable time, NOT the prompt-time
 * defence: every `imported_*` body is still delimiter-wrapped as untrusted
 * and covered by `INJECTION_GUARD` in reviewer-core. The scan exists so a
 * flagged body is surfaced to the user (line + excerpt) and cannot be
 * enabled until edited — see `specs/03-skills.md` "Injection scan".
 *
 * Deliberately a short table of high-signal patterns, tested per line. False
 * positives are surfaced, never silently applied; the user edits the line or
 * accepts the flag. Manual and extracted skills are never scanned.
 */

export interface InjectionRule {
  /** Stable id — the client maps it to copy (`security.rule.<id>`). */
  id: string;
  /** Tested per line; must not carry the `g` flag (stateful `lastIndex`). */
  pattern: RegExp;
}

export const INJECTION_RULES: readonly InjectionRule[] = [
  {
    id: 'instruction_override',
    pattern:
      /\b(ignore|disregard)\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?\b|\byou are now\b|\bnew instructions?:|\bforget\s+(everything|your)\b/i,
  },
  {
    id: 'role_marker',
    pattern: /^\s*(SYSTEM|ASSISTANT|USER)\s*:|<\|im_start\|>|\[INST\]|^\s*#{1,6}\s*System\b/i,
  },
  {
    id: 'prompt_exfiltration',
    pattern: /\b(reveal|print|repeat|show)\b.{0,40}\b(system prompt|your instructions)\b/i,
  },
  {
    id: 'data_exfiltration',
    pattern:
      /!?\[[^\]]*\]\(https?:\/\/[^)\s]*\?[^)\s]+\)|\bsend\b.{0,60}\bto\s+https?:\/\/|\b(curl|wget)\s+https?:\/\//i,
  },
  {
    id: 'hidden_text',
    // Zero-width joiners/spaces, word joiner, BOM, and bidi overrides.
    pattern: /[\u200B-\u200D\u2060\uFEFF\u202A-\u202E]/,
  },
  {
    id: 'delimiter_forgery',
    pattern: /<\/?untrusted\b/i,
  },
  {
    id: 'user_suppression',
    pattern: /\b(do not|don't|never)\s+(tell|inform|show)\s+the\s+user\b|\bhide\s+this\s+from\b/i,
  },
];

/** Longest excerpt shown back to the user per finding. */
export const MAX_EXCERPT_CHARS = 120;

/** One finding per (rule, line); lines are 1-based like an editor. */
export function scanSkillBody(body: string): SkillSecurityFinding[] {
  const findings: SkillSecurityFinding[] = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const rule of INJECTION_RULES) {
      if (rule.pattern.test(line)) {
        findings.push({ rule: rule.id, line: i + 1, excerpt: line.trim().slice(0, MAX_EXCERPT_CHARS) });
      }
    }
  }
  return findings;
}

export function securityReport(body: string): SkillSecurityReport {
  const findings = scanSkillBody(body);
  return { status: findings.length > 0 ? 'flagged' : 'clean', findings };
}

export const NOT_SCANNED: SkillSecurityReport = { status: 'not_scanned', findings: [] };

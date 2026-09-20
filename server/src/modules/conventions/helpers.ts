import { wrapUntrusted } from '@devdigest/reviewer-core';
import {
  ConventionCategory,
  type ChatMessage,
  type ConventionCandidate,
  type ConventionExtraction,
  type ConventionScan,
} from '@devdigest/shared';
import type { ConventionRow, ConventionScanRow } from './repository.js';
import {
  CATEGORY_LABELS,
  CONFIG_FILE_NAMES,
  CONFIG_FILE_PREFIXES,
  CONVENTIONS_SYSTEM_PROMPT,
  DEFAULT_SKILL_NAME,
  EVIDENCE_LINE_TOLERANCE,
  EVIDENCE_SOURCE_LABEL,
  MAX_CANDIDATES,
  MAX_RULE_CHARS,
  MIN_SNIPPET_CHARS,
} from './constants.js';

/**
 * Pure helpers for the conventions extractor: sample rendering, the prompt,
 * the grounding gate, and the skill-body builder. Nothing here touches the
 * filesystem, the database or the container (the clone reader is
 * `repository-samples.ts`, ring 3), so all of it is covered by the hermetic
 * `conventions-helpers.test.ts`.
 */

// ---------------------------------------------------------------- Model output

/** `schemaName` of the extraction call — `MockLLMProvider.structuredBySchema` keys on it. */
export const CONVENTION_EXTRACTION_SCHEMA_NAME = 'ConventionExtraction';

// ---------------------------------------------------------------- Samples

export interface Sample {
  /** Repo-relative posix path, as the model will cite it. */
  path: string;
  kind: 'config' | 'code';
  /** Raw lines (post-truncation), 0-based array — line N is `lines[N - 1]`. */
  lines: string[];
  truncated: boolean;
}

export interface SampleSet {
  samples: Sample[];
  /** Ordered paths that actually went to the model — what grounding checks against. */
  sampledFiles: string[];
}

/** Is `name` one of the config files we feed the model as "already enforced" context? */
export function isConfigFileName(name: string): boolean {
  if (CONFIG_FILE_NAMES.has(name)) return true;
  return CONFIG_FILE_PREFIXES.some((p) => name.startsWith(p));
}

/** Posix-normalise a repo-relative path; `null` when it tries to escape. */
export function normaliseRelPath(rel: string): string | null {
  const p = rel.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (p.length === 0) return null;
  if (p.split('/').some((seg) => seg === '..' || seg === '')) return null;
  return p;
}

/** `"1: import …\n2: …"` — the numbering is what makes a citation checkable. */
export function numberLines(lines: string[]): string {
  return lines.map((l, i) => `${i + 1}: ${l}`).join('\n');
}

/** The text of one sample as the model sees it (numbered, wrapped, marked if cut). */
export function renderSample(sample: Sample): string {
  const body = numberLines(sample.lines) + (sample.truncated ? '\n… (truncated)' : '');
  return wrapUntrusted(`sample:${sample.path}`, body);
}

/** The two messages of the extraction call. */
export function buildExtractionMessages(repoFullName: string, set: SampleSet): ChatMessage[] {
  const configs = set.samples.filter((s) => s.kind === 'config');
  const code = set.samples.filter((s) => s.kind === 'code');
  const parts: string[] = [
    `Extract the house conventions of \`${repoFullName}\` from the samples below.`,
    `Cite evidence only from these ${set.samples.length} files, by the path and line number shown.`,
  ];
  if (configs.length > 0) {
    parts.push(
      `## Config files (${configs.length}) — what tooling already enforces; do not restate these`,
      ...configs.map(renderSample),
    );
  }
  parts.push(`## Source files (${code.length}) — extract conventions from these`, ...code.map(renderSample));
  return [
    { role: 'system', content: CONVENTIONS_SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

// ---------------------------------------------------------------- Grounding

export interface GroundedCandidate {
  category: ConventionCategory;
  rule: string;
  evidencePath: string;
  evidenceLine: number;
  evidenceSnippet: string;
  confidence: number;
}

export interface GroundingResult {
  kept: GroundedCandidate[];
  droppedUngrounded: number;
  droppedDuplicate: number;
}

/** Whitespace-collapsed, trimmed — how snippets and lines are compared. */
export function normaliseSnippet(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Lower-case, punctuation stripped, whitespace collapsed — how rules are deduped. */
export function normaliseRule(rule: string): string {
  return rule
    .toLowerCase()
    .replace(/[`'"“”‘’.,;:!?()[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Where `snippet` occurs in `lines`: the claimed line ± tolerance first, then
 * the whole file. Returns the 1-based line, or `null`.
 */
export function findSnippetLine(
  lines: string[],
  snippet: string,
  claimedLine: number,
  tolerance = EVIDENCE_LINE_TOLERANCE,
): number | null {
  const needle = normaliseSnippet(snippet);
  if (needle.replace(/\s/g, '').length < MIN_SNIPPET_CHARS) return null;
  const matches = (i: number) => i >= 0 && i < lines.length && normaliseSnippet(lines[i]!).includes(needle);
  const claimed = claimedLine - 1;
  for (let d = 0; d <= tolerance; d += 1) {
    if (matches(claimed + d)) return claimed + d + 1;
    if (d > 0 && matches(claimed - d)) return claimed - d + 1;
  }
  for (let i = 0; i < lines.length; i += 1) if (matches(i)) return i + 1;
  return null;
}

/**
 * The gate. A candidate survives only if it cites a file we sampled and a
 * snippet that is really in it; the stored line is where it was FOUND. Rules
 * are deduped within the scan and against `alreadyDecided` (normalised rules
 * of accepted / rejected rows, so a rescan never resurrects a rejection).
 */
export function groundCandidates(
  candidates: ConventionExtraction['candidates'],
  set: SampleSet,
  alreadyDecided: ReadonlySet<string> = new Set(),
): GroundingResult {
  const byPath = new Map(set.samples.map((s) => [s.path, s]));
  const seen = new Set<string>();
  const kept: GroundedCandidate[] = [];
  let droppedUngrounded = 0;
  let droppedDuplicate = 0;

  for (const c of candidates) {
    const rule = c.rule.trim().slice(0, MAX_RULE_CHARS);
    const path = normaliseRelPath(c.evidence.path);
    const sample = path ? byPath.get(path) : undefined;
    if (!rule || !sample) {
      droppedUngrounded += 1;
      continue;
    }
    const line = findSnippetLine(sample.lines, c.evidence.snippet, c.evidence.line);
    if (line === null) {
      droppedUngrounded += 1;
      continue;
    }
    const key = normaliseRule(rule);
    if (seen.has(key) || alreadyDecided.has(key)) {
      droppedDuplicate += 1;
      continue;
    }
    seen.add(key);
    kept.push({
      category: c.category,
      rule,
      evidencePath: sample.path,
      evidenceLine: line,
      evidenceSnippet: sample.lines[line - 1]!.trim(),
      confidence: Math.min(1, Math.max(0, c.confidence)),
    });
  }

  kept.sort((a, b) => b.confidence - a.confidence);
  return { kept: kept.slice(0, MAX_CANDIDATES), droppedUngrounded, droppedDuplicate };
}

// ---------------------------------------------------------------- Skill body

export interface SkillBodyCandidate {
  category: string;
  rule: string;
  confidence: number | null;
  evidencePath: string | null;
  evidenceLine: number | null;
  evidenceSnippet: string | null;
}

const FENCE_BY_EXT: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  mjs: 'js',
  cjs: 'js',
  json: 'json',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  rb: 'ruby',
  sql: 'sql',
  md: 'md',
  yml: 'yaml',
  yaml: 'yaml',
};

function fenceLang(path: string | null): string {
  const ext = path?.split('.').pop()?.toLowerCase() ?? '';
  return FENCE_BY_EXT[ext] ?? '';
}

/**
 * The `repo-conventions` body: rules grouped by category (enum order), each
 * with its confidence and its evidence in a fenced block INSIDE an
 * `<untrusted>` wrapper. Deterministic — same input, same bytes. The rules are
 * trusted instructions (a human accepted each one); the quoted code is repo
 * content and stays data. `react-markdown` drops the unknown tags, so the
 * Preview tab shows a clean code block.
 */
export function buildConventionSkillBody(
  repoFullName: string,
  candidates: SkillBodyCandidate[],
  name = DEFAULT_SKILL_NAME,
): string {
  const order = ConventionCategory.options as readonly string[];
  const groups = new Map<string, SkillBodyCandidate[]>();
  for (const c of candidates) {
    const cat = order.includes(c.category) ? c.category : 'other';
    const arr = groups.get(cat);
    if (arr) arr.push(c);
    else groups.set(cat, [c]);
  }

  const out: string[] = [
    `# ${name}`,
    '',
    `House conventions for \`${repoFullName}\`, extracted from the codebase and reviewed by`,
    'a human. Flag changes in the diff that violate any rule below and cite the',
    'offending `file:line`. Do not flag code the diff does not touch.',
  ];

  for (const cat of order) {
    const items = groups.get(cat);
    if (!items || items.length === 0) continue;
    out.push('', `## ${CATEGORY_LABELS[cat] ?? cat}`);
    for (const c of items) {
      const conf = c.confidence === null ? '' : ` *(confidence ${Math.round(c.confidence * 100)}%)*`;
      out.push(`- ${c.rule}${conf}`);
      if (c.evidencePath && c.evidenceSnippet) {
        const where = c.evidenceLine ? `${c.evidencePath}:${c.evidenceLine}` : c.evidencePath;
        const fenced = `\`\`\`${fenceLang(c.evidencePath)}\n${c.evidenceSnippet}\n\`\`\``;
        out.push(`  Evidence \`${where}\`:`, indent(wrapUntrusted(EVIDENCE_SOURCE_LABEL, fenced), 2));
      }
    }
  }
  return out.join('\n') + '\n';
}

function indent(text: string, n: number): string {
  const pad = ' '.repeat(n);
  return text
    .split('\n')
    .map((l) => (l.length ? pad + l : l))
    .join('\n');
}

/** Distinct evidence paths, in first-seen order — what `skills.evidence_files` records. */
export function evidenceFilesOf(candidates: SkillBodyCandidate[]): string[] {
  const out: string[] = [];
  for (const c of candidates) {
    if (c.evidencePath && !out.includes(c.evidencePath)) out.push(c.evidencePath);
  }
  return out;
}

// ---------------------------------------------------------------- DTOs

export function toCandidateDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    repo_id: row.repoId ?? '',
    category: row.category,
    rule: row.rule,
    evidence_path: row.evidencePath ?? '',
    evidence_line: row.evidenceLine ?? null,
    evidence_snippet: row.evidenceSnippet ?? '',
    confidence: row.confidence ?? 0,
    status: row.status,
    edited: row.edited,
    skill_id: row.skillId ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

export function toScanDto(row: ConventionScanRow): ConventionScan {
  return {
    id: row.id,
    repo_id: row.repoId,
    status: row.status,
    provider: row.provider,
    model: row.model,
    sampled_files: row.sampledFiles,
    candidates_total: row.candidatesTotal,
    candidates_grounded: row.candidatesGrounded,
    dropped_ungrounded: row.droppedUngrounded,
    dropped_duplicate: row.droppedDuplicate,
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    cost_usd: row.costUsd ?? null,
    error: row.error ?? null,
    started_at: row.startedAt.toISOString(),
    finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
  };
}

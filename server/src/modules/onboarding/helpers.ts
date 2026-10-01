import { wrapUntrusted } from '@devdigest/reviewer-core';
import type {
  ChatMessage,
  Onboarding,
  OnboardingCommand,
  OnboardingDraft,
  OnboardingFile,
  OnboardingTask,
} from '@devdigest/shared';
import type { IndexState } from '../repo-intel/types.js';
import {
  ALLOWED_ENV_FILES,
  MAX_COMMANDS,
  MAX_COMMAND_CHARS,
  MAX_DIAGRAM_CHARS,
  MAX_PROSE_CHARS,
  MAX_REASON_CHARS,
  MAX_TASKS,
  ONBOARDING_SYSTEM_PROMPT,
} from './constants.js';

/**
 * Pure helpers for the onboarding generator: file selection, the prompt, the
 * token budget and the grounding gate. Nothing here touches the filesystem, the
 * database or the container (the clone reader is `repository-files.ts`, ring 3),
 * so all of it is covered by the hermetic `onboarding-helpers.test.ts`.
 */

const ELLIPSIS = '…';

// ---------------------------------------------------------------- Selection

/**
 * The critical-path files (AC-8): distinct files across every chain, highest
 * index rank first, equal ranks by path ascending, first `n`. A file with no
 * rank row sorts last.
 */
export function selectCriticalFiles(
  chains: string[][],
  rankOf: ReadonlyMap<string, number>,
  n: number,
): string[] {
  const distinct = [...new Set(chains.flat())];
  distinct.sort((a, b) => (rankOf.get(b) ?? 0) - (rankOf.get(a) ?? 0) || a.localeCompare(b));
  return distinct.slice(0, Math.max(0, n));
}

export type NotIndexedReason = 'flag_off' | 'never_indexed' | 'index_failed' | 'no_ranked_files';

/**
 * Why a generation cannot start from the index (EC-3), or `null` when it can.
 * The facade knows whether rows exist, not why they do not — the reason comes
 * from the flag plus the index state, never from an empty array alone.
 */
export function notIndexedReason(input: {
  enabled: boolean;
  state: Pick<IndexState, 'status' | 'degradedReason'>;
  rankedCount: number;
}): NotIndexedReason | null {
  if (!input.enabled) return 'flag_off';
  if (input.rankedCount > 0) return null;
  const { status, degradedReason } = input.state;
  if (degradedReason === 'no_data') return 'never_indexed';
  if (status === 'failed' || degradedReason === 'index_failed') return 'index_failed';
  return 'no_ranked_files';
}

/** A `.env*` file that is not a template — never read (NFR-5). */
export function isSecretEnvFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (!lower.startsWith('.env')) return false;
  return !(ALLOWED_ENV_FILES as readonly string[]).includes(lower);
}

// ---------------------------------------------------------------- Prompt

export interface SourceText {
  /** Repo-relative posix path. */
  path: string;
  text: string;
}

/** Everything the model is shown. Order of `excerpts` is rank order, highest first. */
export interface PromptInput {
  repoFullName: string;
  /** Index-fixed reading-path files, in rank order. */
  readingPath: string[];
  /** Index-fixed critical-path files, in rank order. */
  criticalPaths: string[];
  /** Root files (README, package.json, …) in allowlist order. */
  runSources: SourceText[];
  excerpts: SourceText[];
  /** Repo skeleton from the index; empty string when none. */
  repoMap: string;
}

/** A path used as a label can come from a clone — keep it from closing the tag. */
function safeLabel(path: string): string {
  return path.replace(/["<>\r\n]/g, '_');
}

/** The two messages of the generation call. Every clone-derived string is wrapped. */
export function buildMessages(input: PromptInput): ChatMessage[] {
  const parts: string[] = [
    `Write the onboarding tour of \`${input.repoFullName}\` from the material below.`,
    'Cite only paths that appear in it.',
  ];

  const listed = [
    ...input.readingPath.map((p) => `- reading path: ${p}`),
    ...input.criticalPaths.map((p) => `- critical path: ${p}`),
  ];
  parts.push('## Files to explain', wrapUntrusted('file-list', listed.join('\n')));

  if (input.runSources.length > 0) {
    parts.push(
      '## Run sources',
      ...input.runSources.map((s) => wrapUntrusted(`file:${safeLabel(s.path)}`, s.text)),
    );
  }
  if (input.excerpts.length > 0) {
    parts.push(
      '## Excerpts',
      ...input.excerpts.map((s) => wrapUntrusted(`excerpt:${safeLabel(s.path)}`, s.text)),
    );
  }
  if (input.repoMap.trim().length > 0) {
    parts.push('## Repo skeleton', wrapUntrusted('repo-map', input.repoMap));
  }

  return [
    { role: 'system', content: ONBOARDING_SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

function countInput(input: PromptInput, countTokens: (s: string) => number): number {
  return countTokens(buildMessages(input).map((m) => m.content).join('\n'));
}

/**
 * NFR-3: drop excerpts from the lowest rank upward until the input fits `max`
 * tokens; if it still does not, drop run sources from the end of the allowlist
 * order. Returns the trimmed input and its final token count.
 */
export function fitToBudget(
  input: PromptInput,
  countTokens: (s: string) => number,
  max: number,
): { input: PromptInput; tokens: number } {
  const trimmed: PromptInput = {
    ...input,
    excerpts: [...input.excerpts],
    runSources: [...input.runSources],
  };
  let tokens = countInput(trimmed, countTokens);
  while (tokens > max && trimmed.excerpts.length > 0) {
    trimmed.excerpts.pop();
    tokens = countInput(trimmed, countTokens);
  }
  while (tokens > max && trimmed.runSources.length > 0) {
    trimmed.runSources.pop();
    tokens = countInput(trimmed, countTokens);
  }
  return { input: trimmed, tokens };
}

// ---------------------------------------------------------------- Grounding

/**
 * G — the set of paths the prompt carried (AC-16 as amended): the listed
 * files plus every run source and excerpt that was actually read. A model path
 * survives only if it is in G.
 */
export function groundedPathSet(input: PromptInput): Set<string> {
  return new Set([
    ...input.readingPath,
    ...input.criticalPaths,
    ...input.runSources.map((s) => s.path),
    ...input.excerpts.map((s) => s.path),
  ]);
}

export interface RemovedCounts {
  reading_path: number;
  critical_paths: number;
  run_locally: number;
  first_tasks: number;
  diagram: number;
}

export interface GroundedSections {
  architecture: Onboarding['architecture'];
  critical_paths: OnboardingFile[];
  run_locally: OnboardingCommand[];
  reading_path: OnboardingFile[];
  first_tasks: OnboardingTask[];
  removed: RemovedCounts;
}

export interface GroundingContext {
  readingPath: string[];
  criticalPaths: string[];
  /** G from `groundedPathSet`. */
  grounded: ReadonlySet<string>;
}

/** One line: newlines and runs of whitespace collapsed, trimmed, capped with `…`. */
function oneLine(text: string, max: number): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + ELLIPSIS : s;
}

/**
 * The gate. File membership and order belong to the index (AC-7): a reason is
 * matched to a listed file by exact path, and a listed file with no reason keeps
 * `reason: null`. A reason for a path in neither list, or a repeat for one path,
 * is dropped and counted under `reading_path`. Commands and task paths survive
 * only when they are in G (AC-16). All text is capped here (NFR-3, A8).
 */
export function groundDraft(draft: OnboardingDraft, ctx: GroundingContext): GroundedSections {
  const removed: RemovedCounts = {
    reading_path: 0,
    critical_paths: 0,
    run_locally: 0,
    first_tasks: 0,
    diagram: 0,
  };

  // Reasons: first one per path wins.
  const listed = new Set([...ctx.readingPath, ...ctx.criticalPaths]);
  const reasonByPath = new Map<string, string>();
  for (const r of draft.file_reasons) {
    if (!listed.has(r.path) || reasonByPath.has(r.path)) {
      removed.reading_path += 1;
      continue;
    }
    reasonByPath.set(r.path, r.reason);
  }
  const toFile = (path: string): OnboardingFile => {
    const raw = reasonByPath.get(path);
    const reason = raw === undefined ? '' : oneLine(raw, MAX_REASON_CHARS);
    return { path, reason: reason.length > 0 ? reason : null };
  };

  // Commands.
  const commands: OnboardingCommand[] = [];
  for (const c of draft.commands) {
    const line = c.line.trim();
    const ok =
      line.length > 0 &&
      line.length <= MAX_COMMAND_CHARS &&
      !/[\r\n]/.test(line) &&
      ctx.grounded.has(c.source_path);
    if (!ok || commands.length >= MAX_COMMANDS) {
      removed.run_locally += 1;
      continue;
    }
    commands.push({ line, source_path: c.source_path });
  }

  // Tasks.
  const tasks: OnboardingTask[] = [];
  for (const t of draft.first_tasks) {
    const text = oneLine(t.text, MAX_REASON_CHARS);
    const paths = [...new Set(t.paths.filter((p) => ctx.grounded.has(p)))];
    if (text.length === 0 || paths.length === 0 || tasks.length >= MAX_TASKS) {
      removed.first_tasks += 1;
      continue;
    }
    tasks.push({ text, paths });
  }

  // Diagram and prose.
  const diagramText = draft.diagram?.trim() ?? '';
  const diagram = diagramText.length > 0 && diagramText.length <= MAX_DIAGRAM_CHARS ? diagramText : null;
  if (diagramText.length > MAX_DIAGRAM_CHARS) removed.diagram = 1;

  const prose = draft.architecture.trim();

  return {
    architecture: {
      prose: prose.length > MAX_PROSE_CHARS ? prose.slice(0, MAX_PROSE_CHARS - 1) + ELLIPSIS : prose,
      diagram,
    },
    critical_paths: ctx.criticalPaths.map(toFile),
    run_locally: commands,
    reading_path: ctx.readingPath.map(toFile),
    first_tasks: tasks,
    removed,
  };
}

// ---------------------------------------------------------------- Staleness

/** EC-9: the index was rebuilt at a different commit than the tour was made from. */
export function isStale(tour: Pick<Onboarding, 'index_sha'>, currentSha: string): boolean {
  return currentSha !== '' && currentSha !== tour.index_sha;
}

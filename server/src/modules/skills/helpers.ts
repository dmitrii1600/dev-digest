import { basename, extname } from 'node:path/posix';
import { unzipSync } from 'fflate';
import type {
  Skill,
  SkillImportEntry,
  SkillImportPreview,
  SkillSource,
  SkillStats,
  SkillType,
  SkillVersion,
} from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from './repository.js';
import {
  DEFAULT_URL_IMPORT_FILENAME,
  DEFAULT_URL_IMPORT_ZIP_FILENAME,
  EXECUTABLE_EXTENSIONS,
  MAX_ENTRIES,
  MAX_ENTRY_BYTES,
  MAX_TOTAL_UNCOMPRESSED,
  SCANNED_SOURCES,
  URL_IMPORT_ACCEPTED_CONTENT_TYPES,
  ZIP_CONTENT_TYPES,
} from './constants.js';
import { NOT_SCANNED, securityReport } from './injection-scan.js';

/**
 * Pure helpers for the skills module — DB row ⇄ DTO mapping and the `.md` /
 * `.zip` import parser. No I/O, so it is unit-testable without a server
 * (`skills-import.test.ts`).
 */

// ---------------------------------------------------------------- DTO mapping

/** `agentCount` is built per request from `agent_skills`; it is never persisted.
 *  So is `security`: an `imported_*` body is re-scanned on every read, which is
 *  what lets an edit clear the flag with no extra state to keep in sync. */
export function toSkillDto(row: SkillRow, agentCount = 0): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
    agent_count: agentCount,
    security: SCANNED_SOURCES.has(row.source) ? securityReport(row.body) : NOT_SCANNED,
  };
}

// ---------------------------------------------------------------- URL import

/** Strip parameters (`; charset=…`) and lower-case; `null` when no header. */
function mediaType(contentType: string | null): string | null {
  if (!contentType) return null;
  return contentType.split(';')[0]!.trim().toLowerCase();
}

/** A missing header is allowed (raw hosts often omit it); `text/html` is not. */
export function isAcceptedContentType(contentType: string | null): boolean {
  const mt = mediaType(contentType);
  return mt === null || URL_IMPORT_ACCEPTED_CONTENT_TYPES.has(mt);
}

function lastPathSegment(url: string): string {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.split('/').filter(Boolean).pop() ?? '');
  } catch {
    return '';
  }
}

/** The filename `parseImport` dispatches on: the URL's last path segment when
 *  it looks like one, else a default keyed on whether the body is a zip. */
export function deriveImportFilename(finalUrl: string, contentType: string | null): string {
  const last = lastPathSegment(finalUrl);
  if (/\.(md|markdown|txt|zip)$/i.test(last)) return last;
  const mt = mediaType(contentType);
  return mt && ZIP_CONTENT_TYPES.has(mt) ? DEFAULT_URL_IMPORT_ZIP_FILENAME : DEFAULT_URL_IMPORT_FILENAME;
}

export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    body: row.body,
    note: row.note ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

export interface SkillStatsAgg {
  agents: number;
  runs30d: number;
  findings30d: number;
  accepted: number;
  dismissed: number;
  byCategory: { category: string; count: number }[];
}

export function toSkillStatsDto(agg: SkillStatsAgg): SkillStats {
  const settled = agg.accepted + agg.dismissed;
  return {
    agents: agg.agents,
    runs_30d: agg.runs30d,
    findings_30d: agg.findings30d,
    accepted: agg.accepted,
    dismissed: agg.dismissed,
    accept_rate: settled === 0 ? null : agg.accepted / settled,
    by_category: agg.byCategory,
  };
}

// ---------------------------------------------------------------- Import

const SKILL_TYPES: ReadonlySet<string> = new Set(['rubric', 'convention', 'security', 'custom']);

interface ExtractedMeta {
  name: string;
  description: string;
  type: SkillType;
  body: string;
}

/**
 * Metadata extraction: a leading `---` fenced block is read with a minimal
 * key:value line parser — NOT a YAML library. This parses untrusted input; a
 * real YAML parser brings anchors/aliases/tags and its own CVE history for no
 * benefit at three string keys. Otherwise name/description fall back to the
 * first `# H1` and the first non-empty paragraph after it.
 */
function extractMetadata(markdown: string): ExtractedMeta {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  if (fm) {
    const kv: Record<string, string> = {};
    for (const line of fm[1]!.split(/\r?\n/)) {
      const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
      if (m) kv[m[1]!.toLowerCase()] = m[2]!.trim().replace(/^["']|["']$/g, '');
    }
    const body = markdown.slice(fm[0].length).trimStart();
    const fallback = deriveFromHeading(body);
    return {
      name: kv.name || fallback.name,
      description: kv.description || fallback.description,
      type: (kv.type && SKILL_TYPES.has(kv.type) ? kv.type : 'custom') as SkillType,
      body,
    };
  }
  const fallback = deriveFromHeading(markdown);
  return { name: fallback.name, description: fallback.description, type: 'custom', body: markdown };
}

function deriveFromHeading(markdown: string): { name: string; description: string } {
  const lines = markdown.split(/\r?\n/);
  let name = 'Untitled skill';
  let description = '';
  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const h = /^#\s+(.+)$/.exec(lines[i]!);
    if (h) {
      name = h[1]!.trim();
      headingIdx = i;
      break;
    }
  }
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line.length > 0) {
      description = line;
      break;
    }
  }
  return { name, description };
}

/** Top-level dispatcher used by the service: `.zip` vs a raw `.md` upload.
 *  `source` only stamps the DTO — a URL and a file go through the same parse. */
export function parseImport(
  filename: string,
  bytes: Uint8Array,
  source: SkillSource = 'imported_file',
): SkillImportPreview {
  if (filename.toLowerCase().endsWith('.zip')) return parseZipImport(bytes, source);
  const raw = new TextDecoder('utf-8').decode(bytes);
  return parseMarkdownImport(raw, source);
}

function parseMarkdownImport(raw: string, source: SkillSource): SkillImportPreview {
  const meta = extractMetadata(raw);
  const entry: SkillImportEntry = {
    path: 'skill.md',
    bytes: new TextEncoder().encode(raw).byteLength,
    kept: true,
    reason: 'skill body',
  };
  return {
    name: meta.name,
    description: meta.description,
    type: meta.type,
    source,
    body: meta.body,
    entries: [entry],
    discarded: 0,
    warnings: [],
    security: securityReport(meta.body),
  };
}

/** Absolute path, drive letter, backslash, or a `..` segment — escapes the root. */
function isPathSafe(path: string): boolean {
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  if (path.includes('\\')) return false;
  return !path.split('/').some((seg) => seg === '..');
}

/** Unix mode is packed in the high 16 bits of the central-directory external
 *  attributes field; S_IFLNK = 0xA000. */
function isSymlinkAttrs(externalAttrs: number): boolean {
  return ((externalAttrs >>> 16) & 0xf000) === 0xa000;
}

/**
 * fflate's `unzipSync` filter callback doesn't expose the zip's external file
 * attributes (where a symlink's unix mode bits live), so we read the central
 * directory ourselves — just enough of PKZIP's APPNOTE.txt to map each entry
 * name to its external-attributes word. Malformed input yields an empty map
 * (every entry then passes the symlink check; the other guards still apply).
 */
function readExternalAttrs(buf: Uint8Array): Map<string, number> {
  const attrsByName = new Map<string, number>();
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const EOCD_SIG = 0x06054b50;
  const CD_SIG = 0x02014b50;
  const maxBack = Math.min(buf.length, 65557); // EOCD (22 bytes) + max comment (64 KiB)
  let eocd = -1;
  for (let i = buf.length - 22; i >= buf.length - maxBack && i >= 0; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return attrsByName;

  const cdEntries = dv.getUint16(eocd + 10, true);
  let cdOffset = dv.getUint32(eocd + 16, true);
  for (let i = 0; i < cdEntries && cdOffset + 46 <= buf.length; i++) {
    if (dv.getUint32(cdOffset, true) !== CD_SIG) break;
    const externalAttrs = dv.getUint32(cdOffset + 38, true);
    const nameLen = dv.getUint16(cdOffset + 28, true);
    const extraLen = dv.getUint16(cdOffset + 30, true);
    const commentLen = dv.getUint16(cdOffset + 32, true);
    const name = new TextDecoder('utf-8').decode(buf.subarray(cdOffset + 46, cdOffset + 46 + nameLen));
    attrsByName.set(name, externalAttrs);
    cdOffset += 46 + nameLen + extraLen + commentLen;
  }
  return attrsByName;
}

function entryDepth(path: string): number {
  return path.split('/').length;
}

/** First match wins, shallowest path first: SKILL.md, then README.md, then the sole `.md`. */
function selectCorePath(mdPaths: string[]): string | undefined {
  const byName = (name: string): string | undefined =>
    mdPaths
      .filter((p) => basename(p).toLowerCase() === name.toLowerCase())
      .sort((a, b) => entryDepth(a) - entryDepth(b))[0];
  return byName('SKILL.md') ?? byName('README.md') ?? (mdPaths.length === 1 ? mdPaths[0] : undefined);
}

function parseZipImport(bytes: Uint8Array, source: SkillSource): SkillImportPreview {
  const entries: SkillImportEntry[] = [];
  const attrsByName = readExternalAttrs(bytes);
  let seen = 0;
  let totalBytes = 0;
  let overBudget = false;

  // fflate's `filter` is called once per central-directory entry BEFORE that
  // entry is inflated — a false return skips inflation entirely, so unsafe /
  // oversized / over-budget entries never get decompressed. Nothing here ever
  // touches disk; everything stays in memory. `originalSize` is the entry's
  // UNCOMPRESSED size (as declared in the central directory) — that's the
  // number the guards below are bounding, not the compressed `size` on disk.
  const unzipped = unzipSync(bytes, {
    filter(file) {
      seen += 1;
      const path = file.name;
      const size = file.originalSize;
      if (path.endsWith('/')) return false; // directory entry, not a file

      if (seen > MAX_ENTRIES) {
        entries.push({
          path,
          bytes: size,
          kept: false,
          reason: `entry limit (${MAX_ENTRIES}) reached — discarded`,
        });
        return false;
      }
      if (!isPathSafe(path)) {
        entries.push({ path, bytes: size, kept: false, reason: 'path escapes archive root — discarded' });
        return false;
      }
      if (isSymlinkAttrs(attrsByName.get(path) ?? 0)) {
        entries.push({ path, bytes: size, kept: false, reason: 'symlink entry — discarded' });
        return false;
      }
      if (EXECUTABLE_EXTENSIONS.has(extname(path).toLowerCase())) {
        entries.push({ path, bytes: size, kept: false, reason: 'executable — discarded' });
        return false;
      }
      if (size > MAX_ENTRY_BYTES) {
        entries.push({
          path,
          bytes: size,
          kept: false,
          reason: `entry too large (${size} bytes, max ${MAX_ENTRY_BYTES}) — discarded`,
        });
        return false;
      }
      if (overBudget || totalBytes + size > MAX_TOTAL_UNCOMPRESSED) {
        overBudget = true;
        entries.push({
          path,
          bytes: size,
          kept: false,
          reason: 'zip bomb suspected — uncompressed budget exceeded — discarded',
        });
        return false;
      }
      totalBytes += size;
      return true; // safe to inflate — classified against the others afterward
    },
  });

  const mdCandidates = Object.keys(unzipped).filter((p) => p.toLowerCase().endsWith('.md'));
  const corePath = selectCorePath(mdCandidates);

  for (const [path, data] of Object.entries(unzipped)) {
    const isMd = path.toLowerCase().endsWith('.md');
    if (path === corePath) {
      entries.push({ path, bytes: data.byteLength, kept: true, reason: 'skill body' });
    } else if (isMd) {
      entries.push({
        path,
        bytes: data.byteLength,
        kept: false,
        reason: 'markdown, not selected as the skill body',
      });
    } else {
      entries.push({ path, bytes: data.byteLength, kept: false, reason: 'not markdown' });
    }
  }

  const discarded = entries.filter((e) => !e.kept).length;

  if (!corePath) {
    return {
      name: '',
      description: '',
      type: 'custom',
      source,
      body: '',
      entries,
      discarded,
      warnings: ['no markdown core found'],
      security: securityReport(''),
    };
  }

  const raw = new TextDecoder('utf-8').decode(unzipped[corePath]);
  const meta = extractMetadata(raw);
  return {
    name: meta.name,
    description: meta.description,
    type: meta.type,
    source,
    body: meta.body,
    entries,
    discarded,
    warnings: [],
    security: securityReport(meta.body),
  };
}

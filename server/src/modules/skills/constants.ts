/** Constants for the skills module. */

/** Initial version recorded for a newly-created skill. */
export const INITIAL_SKILL_VERSION = 1;

// ---- Import limits (.md / .zip) ----

/** A skill is prose — cap the decoded upload. */
export const MAX_UPLOAD_BYTES = 1 * 1024 * 1024; // 1 MiB

/** Base64 is +33% on the wire; cap the JSON field a little above that. */
export const MAX_B64_CHARS = Math.ceil((MAX_UPLOAD_BYTES / 3) * 4) + 4;

/** Entry-count bomb guard for a `.zip` archive. */
export const MAX_ENTRIES = 200;

/** One huge archive member. */
export const MAX_ENTRY_BYTES = 256 * 1024; // 256 KiB

/** Zip bomb guard — checked as entries are inflated, not after the fact. */
export const MAX_TOTAL_UNCOMPRESSED = 4 * 1024 * 1024; // 4 MiB

/** Rejected outright wherever found in an archive; named in the preview. */
export const EXECUTABLE_EXTENSIONS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.bin', '.bat', '.cmd', '.ps1', '.sh',
  '.py', '.rb', '.pl', '.php', '.js', '.mjs', '.cjs', '.ts', '.jar', '.app',
  '.msi', '.com', '.scr', '.vbs', '.wsf', '.apk', '.deb', '.rpm',
]);

// ---- Injection scan + URL import ----

/** Sources whose bodies are scanned on read and gated on enable. `manual` and
 *  `extracted` were authored or accepted by the user and are never scanned. */
export const SCANNED_SOURCES: ReadonlySet<string> = new Set(['imported_url', 'imported_file']);

/** Message of the 422 thrown when a flagged imported skill is enabled. */
export const INJECTION_BLOCK_MESSAGE =
  'Skill body contains possible prompt injection; edit the flagged lines before enabling';

/** Content types a URL import accepts (parameters stripped). `text/html` is
 *  rejected on purpose — the usual mistake is a GitHub blob page, not raw. */
export const URL_IMPORT_ACCEPTED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'text/markdown',
  'text/x-markdown',
  'text/plain',
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
]);

export const ZIP_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'application/zip',
  'application/x-zip-compressed',
]);

/** Filename used when the URL path carries no recognisable one. */
export const DEFAULT_URL_IMPORT_FILENAME = 'SKILL.md';
export const DEFAULT_URL_IMPORT_ZIP_FILENAME = 'SKILL.zip';

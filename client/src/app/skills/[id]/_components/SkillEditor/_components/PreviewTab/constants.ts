/** Sources whose body is delimiter-wrapped as untrusted before it ever
 *  reaches a prompt (mirrors the server's `source !== 'manual'` rule in
 *  `specs/03-skills.md`). */
export const UNTRUSTED_SOURCES: readonly string[] = ["imported_url", "imported_file", "community", "extracted"];

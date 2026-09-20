/** Sources whose body is delimiter-wrapped as untrusted before it ever
 *  reaches a prompt. Mirrors `TRUSTED_SKILL_SOURCES` in the server's
 *  `modules/reviews/run-executor.ts`: `manual` and `extracted` are trusted
 *  (authored or accepted rule by rule by the user); everything else is
 *  wrapped. */
export const UNTRUSTED_SOURCES: readonly string[] = ["imported_url", "imported_file", "community"];

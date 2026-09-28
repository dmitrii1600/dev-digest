/**
 * Identity of the no-auth defaults that `seed()` creates and the local auth
 * adapter looks up. Kept in a leaf module with no imports so
 * `adapters/auth/local.ts` can read two strings without pulling the whole seed
 * graph (`seed-intent.ts`, `seed-blast.ts` → feature repositories/helpers)
 * into the production auth adapter's import graph.
 */
export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

/** Project Context: attach clone Markdown files to agents and skills. */

export const MAX_CONTEXT_FILES = 500;
export const MAX_DOC_BYTES = 64 * 1024;
export const CONTEXT_EXCLUDED_DIRS = ['.git', 'node_modules'] as const;
export const TRUNCATION_MARKER = '\n\n… [truncated at 64 KB]';

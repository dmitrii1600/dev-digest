/** Project Context: attach clone Markdown files to agents and skills. */

export const MAX_CONTEXT_FILES = 500;
export const MAX_DOC_BYTES = 64 * 1024;
export const CONTEXT_EXCLUDED_DIRS = ['.git', 'node_modules'] as const;
export const TRUNCATION_MARKER = '\n\n… [truncated at 64 KB]';

/** Authoring root inside a clone; the only place the Project Context page writes. */
export const SPECS_ROOT = '.devdigest/specs';
export const MAX_NAME_BYTES = 255;
export const FILE_TEMPLATE = '# Untitled spec\n\n## Goals\n- ';
export const FOLDER_TEMPLATE = '# New folder spec\n';
export const FOLDER_SPEC_NAME = 'spec.md';

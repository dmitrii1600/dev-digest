/** Branch the export commits to; one open PR per repo is reused. */
export const CI_BRANCH = 'devdigest/ci';
export const PR_TITLE = 'Add DevDigest CI review';
export const PR_BODY = `Adds the DevDigest review agent to this repository's CI.

Next steps:
1. Add \`OPENROUTER_API_KEY\` to the repository's Actions secrets (Settings → Secrets and variables → Actions).
2. Merge this pull request.
3. Open or update a pull request — the \`DevDigest Review\` workflow will review it.

The runner under \`.devdigest/runner/\` is generated; re-export from DevDigest rather than editing it.
`;

export const WORKFLOW_FILE = 'devdigest-review.yml';
export const WORKFLOW_PATH = '.github/workflows/devdigest-review.yml';
export const ARTIFACT_NAME = 'devdigest-result';
export const RESULT_FILE = 'devdigest-result.json';
export const RUNNER_DIR = '.devdigest/runner';
export const MEMORY_PATH = '.devdigest/memory.jsonl';
export const SKILLS_DIR = '.devdigest/skills';
export const MANIFEST_DIR = '.devdigest/agents';

export const GITATTRIBUTES_PATH = '.gitattributes';
export const GITATTRIBUTES_BODY = '.devdigest/runner/** linguist-generated=true\n';

export const REFRESH_RUNS_PER_REPO = 20;
export const RUNS_LIST_LIMIT = 200;
export const PR_TITLE_MAX = 200;

/**
 * Commit-pinned actions (resolved with `git ls-remote` on 2026-10-11; the tags
 * are lightweight, so the tag sha IS the commit). Never use a tag in `uses:`.
 */
export const PINNED_ACTIONS = {
  checkout: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
  setupNode: 'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0',
  uploadArtifact: 'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2',
} as const;

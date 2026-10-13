import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { AgentManifest, type ArtifactDownload, type WorkflowRunMeta } from '@devdigest/shared';
import {
  assembleFiles,
  buildManifestYaml,
  buildMemoryJsonl,
  buildWorkflowYaml,
  countBlockers,
  slugify,
  uniqueSlugs,
  validateWorkflowYaml,
  verifyRun,
} from '../src/modules/ci/helpers.js';

describe('buildManifestYaml (AC-5)', () => {
  it('round-trips under AgentManifest, including a tricky multi-line prompt', () => {
    const prompt = 'Line one: has a colon\n# not a comment\n  indented "quoted" line\n';
    const yaml = buildManifestYaml(
      {
        name: 'Sec: Reviewer',
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet',
        systemPrompt: prompt,
        strategy: 'map-reduce',
        ciFailOn: 'warning',
      },
      ['a', 'b'],
    );
    const m = AgentManifest.parse(parse(yaml));
    expect(m.model).toBe('anthropic/claude-sonnet');
    expect(m.system_prompt).toBe(prompt);
    expect(m.skills).toEqual(['a', 'b']);
    expect(m.strategy).toBe('map-reduce');
    expect(m.ci_fail_on).toBe('warning');
  });
});

describe('buildWorkflowYaml (AC-6)', () => {
  it.each(['github_review', 'pr_comment', 'none'] as const)('is least-privilege and pinned (%s)', (postAs) => {
    const text = buildWorkflowYaml({ triggers: ['opened', 'reopened'], postAs });
    expect(text).not.toContain('pull_request_target');
    const wf = parse(text);
    expect(Object.keys(wf.on)).toEqual(['pull_request']);
    expect(wf.on.pull_request.types).toEqual(['opened', 'reopened']);
    expect(wf.permissions).toEqual({ contents: 'read', 'pull-requests': 'write' });
    const job = wf.jobs.review;
    expect(job.if).toBe('github.event.pull_request.head.repo.full_name == github.repository');
    for (const step of job.steps) {
      if (step.uses) expect(step.uses).toMatch(/@[0-9a-f]{40}$/);
    }
    const run = job.steps.find((s: { run?: string }) => s.run === 'node .devdigest/runner/index.js');
    expect(run.env.OPENROUTER_API_KEY).toBe('${{ secrets.OPENROUTER_API_KEY }}');
    expect(run.env.GITHUB_TOKEN).toBe('${{ github.token }}');
    expect(run.env.DEVDIGEST_POST_AS).toBe(postAs);
    const up = job.steps.find((s: { name?: string }) => s.name === 'Upload result');
    expect(up.if).toBe('always()');
    expect(up.with.name).toBe('devdigest-result');
    expect(up.with.path).toBe('devdigest-result.json');
  });

  it('renders triggers in a fixed order without duplicates', () => {
    const wf = parse(buildWorkflowYaml({ triggers: ['reopened', 'opened', 'opened'], postAs: 'none' }));
    expect(wf.on.pull_request.types).toEqual(['opened', 'reopened']);
  });
});

describe('verifyRun', () => {
  const inst = { githubRepoId: 100 };
  const run = (over: Partial<WorkflowRunMeta> = {}): WorkflowRunMeta => ({
    id: 1,
    head_sha: 'abc',
    repository_id: 100,
    path: '.github/workflows/devdigest-review.yml',
    html_url: 'https://github.com/o/r/actions/runs/1',
    conclusion: 'success',
    display_title: 't',
    updated_at: '2026-10-11T00:00:00Z',
    pull_requests: [7],
    ...over,
  });
  const artifact = (over: Record<string, unknown> = {}): ArtifactDownload => ({
    kind: 'ok',
    text: JSON.stringify({ findings_count: 1, cost_usd: 0.1, agent: 'a', pr_number: 7, ...over }),
  });

  it('accepts a valid run', () => {
    expect(verifyRun(inst, run(), artifact()).kind).toBe('accepted');
  });
  it('rejects a repo id off by one in either direction', () => {
    expect(verifyRun(inst, run({ repository_id: 101 }), artifact()).kind).toBe('rejected');
    expect(verifyRun(inst, run({ repository_id: 99 }), artifact()).kind).toBe('rejected');
  });
  it('accepts the @ref suffix and rejects near-miss paths', () => {
    const ok = '.github/workflows/devdigest-review.yml@refs/pull/7/merge';
    expect(verifyRun(inst, run({ path: ok }), artifact()).kind).toBe('accepted');
    expect(verifyRun(inst, run({ path: '.github/workflows/devdigest-review.yml.bak' }), artifact()).kind).toBe(
      'rejected',
    );
    expect(verifyRun(inst, run({ path: '.github/workflows/Devdigest-review.yml' }), artifact()).kind).toBe(
      'rejected',
    );
  });
  it('rejects a missing head sha', () => {
    expect(verifyRun(inst, run({ head_sha: null }), artifact()).kind).toBe('rejected');
  });
  it('maps missing/expired to no_result and too_large to rejected', () => {
    expect(verifyRun(inst, run(), { kind: 'missing' }).kind).toBe('no_result');
    expect(verifyRun(inst, run(), { kind: 'expired' }).kind).toBe('no_result');
    expect(verifyRun(inst, run(), { kind: 'too_large' }).kind).toBe('rejected');
  });
  it('rejects non-JSON and schema misses', () => {
    expect(verifyRun(inst, run(), { kind: 'ok', text: 'nope' }).kind).toBe('rejected');
    expect(verifyRun(inst, run(), { kind: 'ok', text: '{"agent":"a"}' }).kind).toBe('rejected');
  });
  it('rejects a null or foreign PR number', () => {
    expect(verifyRun(inst, run(), artifact({ pr_number: null })).kind).toBe('rejected');
    expect(verifyRun(inst, run(), artifact({ pr_number: 8 })).kind).toBe('rejected');
  });
});

describe('validateWorkflowYaml', () => {
  it('enforces the byte cap exactly', () => {
    const base = 'a: ';
    expect(validateWorkflowYaml(base + 'x'.repeat(65_536 - base.length)).ok).toBe(true);
    expect(validateWorkflowYaml(base + 'x'.repeat(65_537 - base.length)).ok).toBe(false);
  });
  it('counts bytes, not UTF-16 units', () => {
    // 'é' is 2 bytes: 32_769 of them exceed the cap while being < 65_536 units.
    expect(validateWorkflowYaml('a: ' + 'é'.repeat(32_769)).ok).toBe(false);
  });
  it('reports a YAML parse error', () => {
    const r = validateWorkflowYaml('a: [b');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });
});

describe('slugify', () => {
  it('normalises names', () => {
    expect(slugify('Security Reviewer!')).toBe('security-reviewer');
    expect(slugify('')).toBe('agent');
    expect(slugify('!!!')).toBe('agent');
    expect(uniqueSlugs(['A', 'a'])).toEqual(['a', 'a-2']);
  });
});

describe('countBlockers', () => {
  const c = { critical: 1, warning: 2, suggestion: 4 };
  it('follows the policy', () => {
    expect(countBlockers(c, 'critical')).toBe(1);
    expect(countBlockers(c, 'warning')).toBe(3);
    expect(countBlockers(c, 'any')).toBe(7);
    expect(countBlockers(c, 'never')).toBe(0);
  });
});

describe('buildMemoryJsonl', () => {
  it('is empty without rows and one JSON object per line otherwise', () => {
    expect(buildMemoryJsonl([])).toBe('');
    expect(buildMemoryJsonl([{ kind: 'k', content: 'c' }])).toBe('{"kind":"k","content":"c"}\n');
  });
});

describe('assembleFiles', () => {
  const input = (includeGitattributes: boolean) =>
    assembleFiles({
      manifestPath: '.devdigest/agents/a.yaml',
      manifestYaml: 'name: a\n',
      skills: [{ slug: 's', body: 'body' }],
      memoryJsonl: '',
      runner: [{ name: 'index.js', contents: 'x' }],
      includeGitattributes,
      workflowYaml: 'wf',
    });

  it('marks only the workflow editable', () => {
    const files = input(true);
    expect(files.filter((f) => f.editable).map((f) => f.path)).toEqual([
      '.github/workflows/devdigest-review.yml',
    ]);
  });
  it('includes exactly one root .gitattributes when asked', () => {
    const ga = input(true).filter((f) => f.path.endsWith('.gitattributes'));
    expect(ga).toHaveLength(1);
    expect(ga[0].path).toBe('.gitattributes');
    expect(ga[0].contents).toBe('.devdigest/runner/** linguist-generated=true\n');
  });
  it('omits .gitattributes otherwise', () => {
    expect(input(false).some((f) => f.path.endsWith('.gitattributes'))).toBe(false);
  });
});

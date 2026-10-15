import { describe, it, expect } from 'vitest';
import { CiExportInput, CiRun, CI_MAX_BYTES } from '@devdigest/shared';

const base = { repo: 'acme/web' };

describe('CiExportInput', () => {
  it('defaults triggers to opened + synchronize', () => {
    const r = CiExportInput.parse(base);
    expect(r.triggers).toEqual(['opened', 'synchronize']);
    expect(r.target).toBe('gha');
    expect(r.action).toBe('open_pr');
    expect(r.post_as).toBe('github_review');
  });

  it('rejects empty, case-variant and near-miss triggers', () => {
    expect(CiExportInput.safeParse({ ...base, triggers: [] }).success).toBe(false);
    expect(CiExportInput.safeParse({ ...base, triggers: ['Opened'] }).success).toBe(false);
    expect(CiExportInput.safeParse({ ...base, triggers: ['pull_request_target'] }).success).toBe(false);
  });

  it('is strict: an unknown key such as base fails', () => {
    expect(CiExportInput.safeParse({ ...base, base: 'main' }).success).toBe(false);
  });

  it('caps workflow_yaml at 65 536 characters', () => {
    expect(CI_MAX_BYTES).toBe(65_536);
    expect(CiExportInput.safeParse({ ...base, workflow_yaml: 'a'.repeat(65_536) }).success).toBe(true);
    expect(CiExportInput.safeParse({ ...base, workflow_yaml: 'a'.repeat(65_537) }).success).toBe(false);
  });

  it('requires owner/name', () => {
    expect(CiExportInput.safeParse({ repo: 'owner' }).success).toBe(false);
    expect(CiExportInput.safeParse({ repo: 'a/b/c' }).success).toBe(false);
  });
});

describe('CiRun', () => {
  it('still parses an object holding only the pre-existing fields', () => {
    const r = CiRun.safeParse({
      id: 'x',
      ci_installation_id: null,
      pr_number: 1,
      ran_at: null,
      status: 'succeeded',
      findings_count: 0,
      cost_usd: null,
      github_url: null,
      source: 'ci',
    });
    expect(r.success).toBe(true);
  });
});

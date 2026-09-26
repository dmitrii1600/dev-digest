import { describe, it, expect } from 'vitest';
import { detectPlanRefs } from '../src/modules/intent/helpers.js';

/**
 * `detectPlanRefs` classifies references in the PR body — attacker-controlled
 * text — so it must never throw on it: a throw fails the whole intent
 * derivation and silently drops the intent/scope section from the review.
 */
describe('detectPlanRefs', () => {
  it('percent-decodes the path of a same-repo blob URL', () => {
    const refs = detectPlanRefs(
      'See https://github.com/acme/app/blob/main/docs/my%20plan.md',
      'acme/app',
    );
    expect(refs).toContainEqual(
      expect.objectContaining({ origin: 'repo_file', target: 'docs/my plan.md' }),
    );
  });

  it('keeps the raw path when the escape is malformed instead of throwing', () => {
    const body = 'Plan: https://github.com/acme/app/blob/main/docs/100%.md';
    expect(() => detectPlanRefs(body, 'acme/app')).not.toThrow();
    expect(detectPlanRefs(body, 'acme/app')).toContainEqual(
      expect.objectContaining({ origin: 'repo_file', target: 'docs/100%.md' }),
    );
  });
});

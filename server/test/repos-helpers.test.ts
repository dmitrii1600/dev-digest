import { describe, it, expect } from 'vitest';
import { toPage } from '../src/modules/repos/helpers.js';

describe('toPage', () => {
  it('returns a page', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const page = toPage(items, 1, 20);
    expect(page).toBeDefined();
    expect(page.length).toBeGreaterThan(0);
  });
});

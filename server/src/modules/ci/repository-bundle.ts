import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunnerBundle, RunnerBundleSource } from './types.js';

/** `agent-runner/dist/`, relative to this file (server/src/modules/ci → repo root). */
const DEFAULT_DIR = fileURLToPath(new URL('../../../../agent-runner/dist/', import.meta.url));

/**
 * Reads the locally built, git-ignored runner bundle. Every regular file of the
 * directory is embedded (ncc emits chunk files whose names can change on a
 * rebuild); `index.js` and `package.json` must be there.
 */
export class RunnerBundleReader implements RunnerBundleSource {
  constructor(private readonly dir: string = DEFAULT_DIR) {}

  async read(): Promise<RunnerBundle | null> {
    try {
      const entries = await readdir(this.dir, { withFileTypes: true });
      const names = entries
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .sort();
      if (!names.includes('index.js') || !names.includes('package.json')) return null;
      const bufs = await Promise.all(names.map(async (name) => ({ name, buf: await readFile(join(this.dir, name)) })));
      const files = bufs.map((f) => ({ name: f.name, contents: f.buf.toString('utf8') }));
      const index = bufs.find((f) => f.name === 'index.js');
      if (!index) return null;
      const sha256 = createHash('sha256').update(index.buf).digest('hex');
      return { files, sha256 };
    } catch {
      return null;
    }
  }
}

/**
 * Multi-agent review: `platform.ts`, `review-api.ts` and `observability.ts` are
 * byte-identical between the server (canonical) and client vendored copies.
 * Same shape as eval-contract-sync.test.ts; line endings are normalised.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

describe.each(["platform.ts", "review-api.ts", "observability.ts"])("%s vendored contract", (file) => {
  it("the client copy equals the server copy", () => {
    const server = read(`../../../server/src/vendor/shared/contracts/${file}`);
    const client = read(`../vendor/shared/contracts/${file}`);
    expect(client.length).toBeGreaterThan(0);
    expect(client).toBe(server);
  });
});

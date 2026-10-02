/**
 * NFR-10 (PR Brief): the two vendored copies of `contracts/brief.ts` are
 * byte-identical. `@devdigest/shared` is vendored twice and the copies have
 * drifted before; the server copy is canonical and the client mirrors it. This
 * file is scoped to the one contract the PR Brief owns, so it is not a general
 * drift gate. It lives in the client lane because the client is the side that
 * mirrors, and it reads both files straight from disk (no import, so no alias
 * can hide a difference). Line endings are normalised so a Windows checkout
 * with `autocrlf` does not fail it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

describe("brief.ts vendored contract", () => {
  it("the client copy equals the server copy", () => {
    const server = read("../../../server/src/vendor/shared/contracts/brief.ts");
    const client = read("../vendor/shared/contracts/brief.ts");
    expect(client.length).toBeGreaterThan(0);
    expect(client).toBe(server);
  });
});

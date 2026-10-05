/**
 * NFR-9 (Eval Pipeline): the vendored copies of `contracts/eval-ci.ts` and
 * `contracts/knowledge.ts` are byte-identical. `@devdigest/shared` is vendored
 * twice and the copies have drifted before (`eval-ci.ts` had lost
 * `AgentManifest` and the `openrouter` provider); the server copy is canonical
 * and the client mirrors it. This file is scoped to the two contracts the eval
 * feature owns, so it is not a general drift gate. It reads both files straight
 * from disk (no import, so no alias can hide a difference). Line endings are
 * normalised so a Windows checkout with `autocrlf` does not fail it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

describe.each(["eval-ci.ts", "knowledge.ts"])("%s vendored contract", (file) => {
  it("the client copy equals the server copy", () => {
    const server = read(`../../../server/src/vendor/shared/contracts/${file}`);
    const client = read(`../vendor/shared/contracts/${file}`);
    expect(client.length).toBeGreaterThan(0);
    expect(client).toBe(server);
  });
});

# Skills control experiment — a documented procedure, not a test

This is **not** automated. A real LLM call is non-deterministic and costs
money — `e2e/` is deliberately model-free and hermetic, and CI never makes a
model call. This is the runbook for demonstrating, by hand, that attaching a
skill measurably changes what an agent flags. Run it locally with a real
provider key configured in **Settings**.

> `acme/payments-api` (the seeded demo repo, PR #482) is synthetic — its
> `repos.clone_path` is `null`, there is no real git history behind it, and it
> exists only to make the PR list and findings screens look populated on a
> fresh database. You cannot run a real review against it. Use a small repo you
> actually own (a scratch repo is fine) added through **Add repository**.

## Setup

1. `./scripts/dev.sh` (Postgres + API + web, migrated and seeded).
2. In **Settings**, add a key for whichever provider the two new agents use
   (**Test Quality Reviewer**, **API Contract Reviewer** — check their `model`
   in the Agent editor; the seed uses the same provider as the starter agents).
3. Add a small real repo you control via **Add repository** and let it index
   (wait for the **Indexed** badge — repo-intel context is not required for
   this experiment, but the badge confirms the clone worked).

## Fixture 1 — Test Quality Reviewer

**Skills attached:** `pr-quality-rubric`, `test-coverage-nudge` (both seeded
`enabled: true` on this agent already).

Create a branch, apply this diff, commit, push, and open a PR:

```diff
diff --git a/src/lib/refund.ts b/src/lib/refund.ts
index 1111111..2222222 100644
--- a/src/lib/refund.ts
+++ b/src/lib/refund.ts
@@ -1,6 +1,15 @@
 export interface RefundResult {
   ok: boolean;
   amountCents: number;
 }
 
-export function refund(orderId: string, amountCents: number): RefundResult {
-  throw new Error('not implemented');
-}
+export function refund(orderId: string, amountCents: number): RefundResult {
+  if (amountCents <= 0) {
+    throw new Error('refund amount must be positive');
+  }
+  if (amountCents > 1_000_000) {
+    throw new Error('refund amount exceeds the single-transaction cap');
+  }
+  return { ok: true, amountCents };
+}
diff --git a/src/lib/refund.test.ts b/src/lib/refund.test.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/lib/refund.test.ts
@@ -0,0 +1,9 @@
+import { describe, it, expect } from 'vitest';
+import { refund } from './refund';
+
+describe('refund', () => {
+  it('refunds a valid amount', () => {
+    const result = refund('order_123', 500);
+    expect(result.ok).toBe(true);
+    expect(result.amountCents).toBe(500);
+  });
+});
```

The test only covers the happy path — it never exercises the `<= 0` or
`> 1_000_000` branches just added.

**Procedure:**

1. Import the PR. On the Agent editor's **Skills** tab for Test Quality
   Reviewer, uncheck both skills (leave the binding, just disable it). Run a
   review. Expected: the agent passes the diff — nothing flags the missing
   boundary/error-path coverage; this is a plausible-looking, mechanically
   correct diff.
2. Re-check both skills (back to seeded state) and run again. Expected: the
   agent now flags the uncovered `amountCents <= 0` and `> 1_000_000` branches
   — `test-coverage-nudge`'s "the branch that got smaller" / "failure paths"
   guidance is exactly what should catch this.
3. Open the run trace for both runs (`RunTraceDrawer`). Confirm: run 1 has no
   **Skills** prompt block; run 2 has a **Skills** block with a token count,
   and the run's Live Log carries `skills: 2 skill(s) attached (T tokens)`.

## Fixture 2 — API Contract Reviewer

**Skills attached:** `pr-quality-rubric`, `api-contract-gate` (both seeded
`enabled: true` on this agent already).

```diff
diff --git a/src/routes/orders.ts b/src/routes/orders.ts
index 4444444..5555555 100644
--- a/src/routes/orders.ts
+++ b/src/routes/orders.ts
@@ -10,11 +10,11 @@ export default async function ordersRoutes(app: FastifyInstance) {
   app.get('/orders/:id', async (req, reply) => {
     const order = await getOrder(req.params.id);
     if (!order) {
-      reply.status(404);
-      return { error: 'not_found' };
+      reply.status(200);
+      return null;
     }
-    return { id: order.id, total_cents: order.totalCents, status: order.status };
+    return { id: order.id, total: order.totalCents, status: order.status };
   }
   );
 }
```

Two breaking changes: a missing order now returns `200 null` instead of
`404 { error }`, and the response field renames `total_cents` → `total`.

**Procedure:** same shape as Fixture 1 — run once with the API Contract
Reviewer's skills unlinked/disabled (expect it to pass a diff that "looks"
like a small rename), once with them enabled (expect it to flag both the
status-code change on the not-found path and the field rename as breaking
changes to existing callers, per `breaking-change`'s and
`semver-discipline`'s guidance — the four API Contract skills are
`breaking-change`, `response-schema`, `semver-discipline`,
`deprecation-policy`, seeded in `server/src/db/seed-skills.ts`). Check the
same three things in the run trace.

## Fixture 3 — `repo-conventions` (extracted skill)

**Skills attached:** the skill you create on **Skills Lab → Conventions**.

1. Open **Conventions** for the real repo you added in Setup and click **Run
   Scan** (the repo must show the **Indexed** badge first — the sampler reads
   the ranked index). Expect a list of candidates, each with a `file:line`
   that really exists in the clone; the header names how many sample files
   went in and how many candidates were dropped for citing something that was
   not there.
2. **Reject** at least one candidate, **Edit** another, **Accept** two or
   three. Click **ReScan**: the rejected rule does not come back, the edited
   rule keeps your text.
3. Click **Create skill**, tick **General Reviewer** (nothing is preselected;
   you may also create it unbound and attach it later from the agent's Skills
   tab — do attach it before step 4), edit the body if you like, **Create**.
   You land on the new skill's Preview tab; the `/skills` grid lists it with
   source *extracted* and `1 agent`.
4. Open a PR in that repo that violates one accepted rule (for example a
   `.then()` chain when the rule says async/await) and run **General
   Reviewer** twice: once with the skill's binding **disabled** on the agent's
   Skills tab, once **enabled**. Expect the violation flagged only in the
   second run.
5. In the second run's trace, the **Skills** block contains the rule text
   **unwrapped** (it is an instruction) and each quoted evidence line inside
   `<untrusted source="convention-evidence">` (it is repo content). Compare
   with the seeded `no-then-chains` skill, which — as an imported file — is
   wrapped whole.

## What this demonstrates

- A skill is genuinely load-bearing content, not a decorative badge: the same
  agent, same model, same diff produces a different review depending on
  whether the skill is attached and enabled.
- The **Skills** prompt block and its token count are visible in the run
  trace exactly when a skill was actually sent, and never otherwise — with
  nothing attached/enabled, the section is omitted and every other agent's
  prompt is unaffected (see `specs/03-skills.md`'s Acceptance section).

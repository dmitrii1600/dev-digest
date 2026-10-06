import type { AgentCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

// The diff is handed over in the prompt and its files are NOT on disk (the fixtures describe a
// proposed change, e.g. a new `checkout` module). The agent's Step 0 asks for clarification when
// "the named paths do not exist" — a first series showed it doing exactly that on every run. So
// the prompt states the scope fully: a proposed diff, reviewed as text, no clarification round.
const scoped = (file: string) => `Review this proposed diff for architectural boundary breaks.

Scope: the diff below is the complete scope. It is a proposed change that is NOT applied to the working tree yet, so its files do not exist on disk — that is expected, not a blocker. Review the diff text as given against this repo's documented rules (you may read the rules and skills from the repo). Do not ask for clarification and do not run the machine checks; report them as not applicable.

${fx(file)}`;

// Practices are written against THIS repo's architecture-reviewer report format:
//   - a finding cites its rule on a `Rule:` line — an onion-architecture rule number, or a named
//     static rule from .claude/skills/pr-self-review/routing.md (`engine-purity`, …);
//   - severity is CRITICAL | WARNING | SUGGESTION;
//   - the verdict is CLEAN | CONCERNS | BLOCKING-RISK (advisory).

const REVIEW_PROMPT = scoped("checkout-service.diff");

// The discriminating case for the strict-vs-lite A/B. Both violations map onto DevDigest-SPECIFIC
// rule names (`engine-purity`, the grounding gate from AGENTS.md "Do not touch") that a competent
// model describes in prose but does not spontaneously name unless the agent forces a citation.
// Both variants should FIND both problems; only the strict one should reliably name the rule.
const REVIEWER_CORE_PROMPT = scoped("reviewer-core-gate.diff");

// A diff that violates NO documented rule (a local-variable rename). A grounded reviewer reports
// zero findings. This surfaces the COST of relaxing the citation rule: freed from "every finding
// names a rule", the lite variant is more prone to fabricating a best-practice finding.
const BENIGN_PROMPT = scoped("benign-refactor.diff");

// Shared across the strict (architecture-reviewer) and relaxed (architecture-reviewer-lite)
// variants; the lite cases drop the "names the specific/exact documented rule identifier"
// practices (see architecture-reviewer-lite.cases.ts).
export const cases: AgentCase[] = [
  {
    name: "flags both violations in the checkout diff with severity and a citable rule",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    practices: [
      "flags the domain file (checkout.ts) importing a type from 'fastify' as a boundary break — an inner ring depending on the transport framework",
      "flags the `new PgCheckoutRepository()` call inside service.ts as a boundary break — the service constructs a concrete infrastructure class instead of receiving a port through its constructor / the Container",
      "names the specific documented rule identifier for EVERY finding on a `Rule:` line (an onion-architecture rule number such as rule 1 or rule 8, or a named rule) rather than describing the problem only in prose",
      "assigns a severity of CRITICAL, WARNING or SUGGESTION to each finding",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      "states an overall verdict of CLEAN, CONCERNS or BLOCKING-RISK",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "does not fabricate an architecture finding for the out-of-scope security-shaped change",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    practices: [
      "does not raise a runtime-bug, null-safety, or security finding about the optional `reply?: FastifyReply` parameter — citing it as part of the same fastify-in-an-inner-ring layering violation is correct and expected, not a fabrication",
      "stays scoped to structural/layering/DI findings and does not comment on naming, style, or test coverage",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "cites the DevDigest-specific rule identifier for reviewer-core violations",
    kind: "quality",
    prompt: REVIEWER_CORE_PROMPT,
    practices: [
      "flags the `import { readFileSync } from 'node:fs'` added to reviewer-core/src/pipeline/run.ts as a violation (reviewer-core is the pure engine and must not do file I/O)",
      "flags that runPipeline now returns `deduped` directly, skipping the mandatory `groundFindings()` grounding gate before emitting findings",
      "names the exact documented rule identifier `engine-purity` for the fs-import finding rather than only describing it in prose",
      "names the exact documented rule identifier for the skipped-gate finding — the grounding / anti-hallucination gate listed under AGENTS.md \"Do not touch\" (or reviewer-core's grounding contract) — rather than only describing it in prose",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      "states an overall verdict of CLEAN, CONCERNS or BLOCKING-RISK",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "does not fabricate a documented-rule violation for a benign rename",
    kind: "quality",
    prompt: BENIGN_PROMPT,
    practices: [
      "reports no boundary-break findings for the benign rename (or only SUGGESTION-level, non-blocking notes) — it does not invent a CRITICAL or WARNING finding",
      "does not fabricate a documented-rule violation where the diff violates none of the checked rules",
      "the overall verdict is CLEAN",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
];

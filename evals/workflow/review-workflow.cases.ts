import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (CLAUDE.md → AGENTS.md + skills +
 * subagents, loaded via settingSources:["project"]) behaves as documented. Organized by scenario,
 * not by a single artifact, because these behaviors are cross-cutting.
 *
 * Every expected path is a row of the root AGENTS.md "Read when" table (or a package AGENTS.md
 * it points to) — when a row moves, the case moves with it.
 *
 * Budget: 6 Claude sessions total.
 *   - 2 × trace     → 1 session each                      = 2
 *   - 1 × contrast  → treatment + control                 = 2
 *   - 1 × activation pair (positive + near-miss negative) = 2
 *
 * `trace` folds several assertions into ONE session (cheaper, coarser) and stops early once its
 * evidence is in — so a dispatch-bearing trace never waits out the nested subagent's full run.
 */
export const cases: WorkflowCase[] = [
  // --- trace (1 session): AGENTS.md "Read when" routing + subagent dispatch, together -----------
  {
    kind: "trace",
    // Endpoint must NOT already exist, or the model reviews the existing code inline instead of
    // planning-then-dispatching. GET /reviews/:id/export is genuinely absent from
    // server/src/modules/reviews/routes.ts.
    name: "API-route task reads server/README.md AND pulls the architecture-reviewer",
    prompt:
      "Я планую додати НОВИЙ, ще не реалізований ендпоінт GET /reviews/:id/export (віддає ревʼю як " +
      "markdown). Спершу звірся з настановами цього репо щодо додавання роутів. Потім ОБОВʼЯЗКОВО запусти " +
      "сабагента architecture-reviewer, щоб він оцінив мій план на відповідність onion-шарам — не рецензуй сам.",
    // AGENTS.md: "API and DI map → server/README.md — read before adding a route or adapter".
    expectFilesRead: ["server/README.md"],
    expectSubagents: ["architecture-reviewer"],
    // Read the routed docs, form a plan, THEN dispatch the subagent — Haiku needs room to reach
    // the dispatch step; at 8 turns it runs out mid-exploration and never delegates.
    maxTurns: 25,
  },

  // --- trace (1 session): AGENTS.md routing for the review engine -------------------------------
  {
    kind: "trace",
    // The prompt pushes toward CONSULTING the guidelines, not exploring source — otherwise the
    // model goes straight into reviewer-core/src and never opens the routed doc.
    name: "pipeline task follows AGENTS.md routing to reviewer-core/README.md",
    prompt:
      "Я збираюся змінити збирання промпту в review engine. Перш ніж торкатися коду — звірся з настановами " +
      "цього репо (CLAUDE.md / AGENTS.md) щодо того, яку документацію треба прочитати, і прочитай саме її.",
    // AGENTS.md: "Review engine pipeline → reviewer-core/README.md — read before touching prompt assembly".
    expectFilesRead: ["reviewer-core/README.md"],
    maxTurns: 8,
  },

  // --- contrast (2 sessions): does the project context CAUSE the read? -------------------------
  // Treatment runs in the real repo with the project harness; control runs the same prompt in an
  // empty tmpdir with no settings, so it has no AGENTS.md to route by. Only the treatment may read
  // the module INSIGHTS.md. Read-only tools on both sides.
  {
    kind: "contrast",
    name: "AGENTS.md routes an unexpected-behaviour lookup to reviewer-core/INSIGHTS.md",
    prompt:
      "У reviewer-core я стикнувся з несподіваною поведінкою — щось працює не так, як я очікував. " +
      "За настановами цього репо, де вже записано те, що команда дізналась на власних помилках? Прочитай той файл.",
    // AGENTS.md: "Hard-won lessons and decisions → the touched module's INSIGHTS.md".
    expectFileRead: "reviewer-core/INSIGHTS.md",
    tools: ["Read", "Grep", "Glob"],
    maxTurns: 6,
  },

  // --- activation pair (2 sessions): positive + near-miss negative ------------------------------
  {
    kind: "activation",
    name: "engineering-insights activates on a genuine discovery",
    prompt:
      "Щойно з'ясував, чому pgvector-запит повертав нуль рядків — розмірність колонки не збіглася " +
      "після зміни моделі ембедингів. Хочу це зафіксувати, щоб більше не наступати.",
    skill: "engineering-insights",
    shouldActivate: true,
    // Room to explore the discovery and then invoke the Skill tool; 4 turns cut it off mid-work.
    maxTurns: 15,
    // Whether the model invokes the Skill tool vs. writing the insight directly is behaviour-shaped
    // (README: "indicative, not blocking"). Record a miss as ⚠, don't fail the gate.
    indicative: true,
  },
  {
    kind: "activation",
    name: "near-miss negative — explaining the same topic must NOT record an insight",
    prompt:
      "Поясни, як у pgvector працюють розмірності колонок і чому невідповідність повертає нуль рядків.",
    skill: "engineering-insights",
    shouldActivate: false,
    // Symmetric budget with the positive case so the pair differs only by prompt, not turn count.
    maxTurns: 15,
  },
];

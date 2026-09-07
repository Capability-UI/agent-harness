# Autoresearch brief: improve the agent-harness

This directory runs a Karpathy-style autoresearch loop over the agent-harness. A
researcher model proposes one change at a time to a single source file; a fixed,
integrity-protected evaluator scores the harness; and a git ratchet keeps a change
only when the score strictly improves, otherwise reverts it.

## Metric (single source of truth)
`research/eval/run.mjs` runs a fixed battery of coding tasks through the real
harness `run` loop and prints JSON:

- `passes` — number of tasks whose deterministic grader passed (primary metric, higher is better).
- `totalTurns` — sum of agent turns across tasks (tie-breaker, lower is better when `passes` is equal).

The driver accepts a proposal only when it (a) builds, (b) keeps every existing
unit test passing, and (c) strictly improves the metric `(passes, -totalTurns)`.

## What the researcher may change
Exactly one file per iteration, chosen by the driver from the harness `src/`
tree (for example `src/loop.ts`, `src/tools.ts`, `src/context.ts`, `src/provider.ts`).
The evaluator (`research/eval/**`) and tests are read-only and must not be edited.

## Research directions (in priority order)
1. Make tool affordances legible to the model: clear tool descriptions and
   argument docs so the agent picks the right tool and arguments on the first try.
2. Improve robustness of the loop: recover from malformed tool calls and transient
   model/provider errors without aborting the whole run.
3. Improve context economy: keep the most useful signal within the turn budget.

## Hard constraints
- Keep changes minimal, typed, and non-interactive. No new runtime dependencies.
- Never weaken the workspace jail or the deny-by-default policy.
- Never edit the evaluator, its tasks, or the grading logic.

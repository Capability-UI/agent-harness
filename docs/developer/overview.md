# Developer docs

This repository is the agent **harness** (loop, context, memory, evaluation) on top of Capability UI Protocol (**CUP**) for tools, identity, policy, and receipts.

## Documents

| Doc | Role |
| --- | --- |
| [llm-agent-harness-research.md](../llm-agent-harness-research.md) | Research synthesis, including Recursive Language Models and Continual Harness |
| [plans/2026-09-07-001-plan-capability-ui-harness.md](../plans/2026-09-07-001-plan-capability-ui-harness.md) | Build plan and open questions |

## Related tree

Capability-UI lives in the sibling checkout used by this workspace. Runtime types and policy live in that package (`src/runtime.ts`, `src/adapters.ts`). CUP does not run the agent loop.

When implementation lands, keep this folder current: how to run the host, how subjects are minted, where session files live, and how evals disclose the harness.

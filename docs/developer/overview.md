# Developer docs

This repository is a **coding agent CLI** (`harness`). Capability UI is the kernel for tools, identity, policy, and receipts. This repo owns the loop, context assembly, session log, and workspace jail.

## Run

The harness builds standalone (CUP is vendored as a prebuilt package; no sibling needed):

```bash
cd agent-harness && npm install && npm run build
npx harness init --workspace .
npx harness tools --workspace .
OPENAI_API_KEY=... npx harness run "run the tests" --workspace .
```

OpenRouter (or any OpenAI-compatible endpoint):

```bash
npx harness run "run the tests" --workspace . \
  --base-url https://openrouter.ai/api/v1 \
  --api-key "$OPENROUTER_API_KEY" \
  --model anthropic/claude-sonnet-4
```

Env vars `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL` work the same way. CLI flags override env.

`package.json` depends on `@capability-ui/core` as a **pinned git dependency** from the public repo (`git+https://github.com/Capability-UI/Capability-UI.git#<commit>`), so the harness builds standalone with no sibling `../Capability-UI` checkout. npm clones the pinned commit and runs CUP's `prepare` script to build it on install. Bump the SHA to update. (GitHub Packages `@capability-ui/core@0.2.0` remains an option but requires a `read:packages` token even for public packages.)

## Layout

| Path | Role |
| --- | --- |
| `src/host.ts` | deny-by-default CUP, `agent:coder` |
| `src/tools.ts` | ACI capabilities |
| `src/loop.ts` | ReAct through `cup.execute` |
| `src/context.ts` | AGENTS.md map, skill index, observation masking |
| `src/session.ts` | `.harness/sessions/*.jsonl` |
| `src/repl.ts` | reserved RLM interface |

Harness state lives under `.harness/` (`prompt.md`, `progress.md`, `memory.json`, `skills/`, `agents/`). There is no automatic Continual Harness Refiner in v1. The agent may append progress and rewrite memory JSON through CUP.

## Plans

- v1 harness: [plans/2026-09-07-001-plan-capability-ui-harness.md](../plans/2026-09-07-001-plan-capability-ui-harness.md)
- CUP resources, subagents, and the agent protocol: [plans/2026-09-08-001-cup-resources-and-subagents.md](../plans/2026-09-08-001-cup-resources-and-subagents.md)

v1 uses a single `agent:coder` subject and disk files that are not CUP resources. The 2026-09-08 plan treats created work as CUP resources with strict policies, persists subagent system prompts, isolates memory per subject, and uses CUP grants as the operating model for what a subagent may do. That plan's **Data architecture** section is the map of catalog jsonl, file bodies, and session/receipt logs.

## Tests

```bash
npm test
```

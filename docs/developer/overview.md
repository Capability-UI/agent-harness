# Developer docs

This repository is a **coding agent CLI** (`harness`). Capability UI is the kernel for tools, identity, policy, and receipts. This repo owns the loop, context assembly, session log, and workspace jail.

## Run

From a workspace that also has `Capability-UI` as a sibling directory (this environment):

```bash
cd Capability-UI && npm install && npm run build
cd ../agent-harness && npm install && npm run build
npx harness init --workspace .
npx harness tools --workspace .
OPENAI_API_KEY=... npx harness run "run the tests" --workspace .
```

`package.json` depends on `@capability-ui/core` via `file:../Capability-UI`, matching CUP examples. Published consumers should switch that to GitHub Packages `@capability-ui/core@0.2.0`.

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

## Tests

```bash
npm test
```

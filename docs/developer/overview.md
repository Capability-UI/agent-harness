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

`package.json` depends on `@capability-ui/core` as a **prebuilt package tarball** vendored at `vendor/capability-ui-core.tgz` (`file:vendor/capability-ui-core.tgz`), so the harness builds standalone with no sibling `../Capability-UI` checkout and without recompiling CUP. Regenerate it with `./scripts/vendor-cup.sh ../Capability-UI` when CUP changes. Registry consumers can instead switch to GitHub Packages `@capability-ui/core@0.2.0` (needs a `read:packages` token).

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

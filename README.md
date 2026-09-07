# agent-harness

A coding-agent CLI in the same family as Claude Code, Codex, Pi, and Prime Agent.
The [Capability UI Protocol (CUP)](../Capability-UI) is the kernel for tool
definitions, authorization, and receipts; **this** repo owns the agent loop,
context assembly, session log, and the workspace jail.

- **Model-agnostic**: any OpenAI-compatible chat-completions endpoint (OpenAI, OpenRouter, local servers).
- **Capability-governed tools**: every tool call goes through CUP's deny-by-default policy and produces a receipt.
- **Jailed workspace**: all file and shell operations are confined to a single workspace root.
- **Durable memory & skills**: progress notes, JSON memory, and a skills catalog persist under `.harness/`.
- **Built-in autoresearch**: a Karpathy-style git-ratchet loop plus real benchmarks (HumanEval, HumanEval+, MultiPL-E TS) for improving the harness itself.

---

## Requirements

- Node.js **>= 20** (developed on Node 22).
- For `harness run`: an API key for an OpenAI-compatible endpoint.

No sibling checkout is required. The CUP kernel (`@capability-ui/core`) is consumed
directly from the public [`Capability-UI`](https://github.com/Capability-UI/Capability-UI)
repository as a **pinned git dependency** (`git+https://github.com/Capability-UI/Capability-UI.git#<commit>`).
On install, npm clones that commit and runs CUP's `prepare` script to build it, so
`npm install` resolves the package with no sibling and no registry auth.

## Install & build

The harness builds standalone — no `../Capability-UI` needed:

```bash
cd agent-harness
npm install        # clones + builds the pinned @capability-ui/core commit
npm run build
```

The CLI binary is `dist/src/cli.js` (exposed as `harness`). Re-run `npm run build`
after a clean install or any source change. For a no-build dev loop use
`npm run harness -- <args>` (runs `src/cli.ts` through `tsx`).

### Updating the pinned CUP version

Bump the commit SHA in the `@capability-ui/core` dependency in `package.json`, then
`rm -rf node_modules package-lock.json && npm install` to re-pin.

> **Note:** npm records the lockfile `resolved` URL for GitHub git dependencies in
> `git+ssh://` form. If your environment lacks GitHub SSH access, force HTTPS with:
> `git config --global url."https://github.com/".insteadOf ssh://git@github.com/`

## Quickstart

```bash
# scaffold .harness/ state in a target workspace
npx harness init --workspace .

# list the CUP-authorized tools available to the coder agent
npx harness tools --workspace .

# run the agent against a goal (requires an API key)
OPENAI_API_KEY=... npx harness run "fix the failing test" --workspace .
```

## Providers & configuration

The harness talks to any OpenAI-compatible `/chat/completions` endpoint. Configure
it with environment variables or CLI flags (**flags override env**):

| Env var | Flag | Purpose | Default |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | `--api-key` | API key (required for `run`) | — |
| `OPENAI_BASE_URL` | `--base-url` | API root, e.g. an OpenRouter or local URL | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | `--model` | Model id | `gpt-4.1-mini` |

Example against OpenRouter (or any compatible gateway):

```bash
export OPENAI_API_KEY="$OPENROUTER_API_KEY"
export OPENAI_BASE_URL="$YOUR_OPENAI_COMPATIBLE_BASE_URL"   # e.g. OpenRouter's /api/v1 root
export OPENAI_MODEL="anthropic/claude-sonnet-4"
npx harness run "make the tests pass" --workspace .
```

The provider layer (`src/provider.ts`) also handles real-world endpoint quirks:
it sanitizes CUP tool ids (which contain dots) into the OpenAI function-name
grammar and maps them back, retries transient/5xx errors with backoff, flattens
array-form message content, and strips reasoning-model `<think>` chain-of-thought
from the final answer.

## CLI reference

```
harness <run|init|tools> [prompt] [options]
```

| Command | Description |
| --- | --- |
| `run <prompt>` | Run the agent loop toward a goal (needs an API key). |
| `init` | Create the `.harness/` layout in the workspace. |
| `tools` | List the CUP-authorized tools for `agent:coder`. |

| Option | Description | Default |
| --- | --- | --- |
| `--workspace <dir>`, `-C` | Workspace root (the jail) | cwd |
| `--max-turns <n>` | Turn budget for the loop | 40 |
| `--api-key <key>` | Override `OPENAI_API_KEY` | — |
| `--base-url <url>` | Override `OPENAI_BASE_URL` | — |
| `--model <id>` | Override `OPENAI_MODEL` | — |
| `--help`, `-h` | Show usage | — |

## Tools (CUP capabilities)

Tools are registered as CUP capabilities and authorized for the `agent:coder`
subject. Each carries a risk tier, side-effect metadata, and an argument schema
that is surfaced to the model as a function description.

| Capability | Risk | What it does |
| --- | --- | --- |
| `workspace.read` | low | Read a text file from the workspace. |
| `workspace.write` | medium | Create/overwrite a file. |
| `workspace.edit` | medium | Replace one exact, unique occurrence of a string. |
| `workspace.glob` | low | List files matching a glob (supports `**`). |
| `workspace.grep` | low | Search file contents by JavaScript regex. |
| `workspace.bash` | high | Run a shell command from the workspace root. |
| `harness.memory.read` | low | Read AGENTS.md, progress, skills, and features. |
| `harness.memory.append_progress` | low | Append a durable progress note. |
| `harness.memory.write_json` | medium | Persist a structured JSON memory value. |
| `harness.skill.read` | low | Load a named skill body from the catalog. |
| `harness.features.read` | low | Read the feature list with pass/fail status. |

## How the loop works

`src/loop.ts` implements a ReAct-style loop:

1. Project a CUP **authorized view** for `agent:coder` to get the tool set.
2. Build the system prompt from harness state (`src/context.ts`).
3. Ask the model for the next assistant turn (text + tool calls).
4. Dispatch each tool call through `cup.execute` — CUP authorizes it, runs the
   handler, and returns a **receipt**; the observation is fed back to the model.
5. Stop when the model emits no tool calls (`model_halt`) or the turn budget is hit (`max_turns`).

To keep context bounded, only the last `KEEP_LAST_FULL_OBSERVATIONS` (5) tool
outputs are kept verbatim; older ones are masked. Large observations are capped at
`OBSERVATION_CHAR_CAP` (32 KB) and spilled to a workspace artifact path. Shell
commands time out after `BASH_TIMEOUT_MS` (30 s). See `src/constants.ts`.

## Harness state (`.harness/`)

`harness init` (and the first `run`) scaffold per-workspace state:

| File / dir | Role |
| --- | --- |
| `prompt.md` | Base system prompt. |
| `progress.md` | Appended progress notes (durable memory). |
| `memory.json` | Structured JSON memory. |
| `skills/` | Skill bodies loaded on demand via `harness.skill.read`. |
| `agents/` | Sub-agent specs. |
| `sessions/*.jsonl` | Per-run event logs. |
| `feature_list.json` | Feature pass/fail tracking. |

## Capability UI integration

`src/host.ts` builds a deny-by-default CUP instance and registers the coding
capabilities from `src/tools.ts`, granting `agent:coder` `discover`/`inspect`/
`execute` on each. Because authorization is explicit, the agent cannot invent
tools it was not granted, and every execution yields an auditable receipt. Tool
descriptions authored here flow through CUP's `AuthorizedCapability.description`
into the function specs the model sees.

## Autoresearch & benchmarks

`research/` contains a self-improvement harness modeled on Karpathy's autoresearch
ratchet: propose one change → build → run unit tests → run a fixed evaluator →
keep the change only if it strictly improves `(passes, -totalTurns)`, otherwise
`git checkout` reverts it.

```bash
# score the harness on a benchmark (uses OPENAI_* env for the solver model)
EVAL_BATTERY=humaneval HUMANEVAL_N=10 node research/eval/run.mjs

# run the ratchet loop (researcher + solver = OPENAI_MODEL)
EVAL_BATTERY=multiplts RESEARCH_ITERATIONS=4 node research/loop.mjs
```

Batteries (select with `EVAL_BATTERY`):

| Battery | Source | Grader | Notes |
| --- | --- | --- | --- |
| `battery` | synthetic | `node` | quick smoke tasks (default) |
| `hard` | synthetic | `node` | tight-budget tasks: edit-uniqueness, large-file, multi-file refactors, masking recall |
| `humaneval` | `openai/openai_humaneval` | `python3` | real HumanEval, official hidden tests |
| `humanevalplus` | `evalplus/humanevalplus` | `python3` + numpy | HumanEval with stricter EvalPlus tests |
| `multiplts` | `nuprl/MultiPL-E` (`humaneval-ts`) | `tsx` | HumanEval translated to TypeScript (native) |

Real benchmark data is fetched from the HuggingFace datasets-server and cached
under `research/eval/data/` for reproducibility (`research/eval/fetch-benchmark.mjs`,
`fetch-humaneval.mjs`). See `research/program.md` for the research brief and
`research/results*.tsv` for recorded ratchet runs.

## Project layout

| Path | Role |
| --- | --- |
| `src/cli.ts` | Argument parsing and command dispatch. |
| `src/host.ts` | Deny-by-default CUP, `agent:coder` subject. |
| `src/tools.ts` | Coding capabilities (the ACI tool set). |
| `src/loop.ts` | ReAct loop over `cup.execute`. |
| `src/context.ts` | System prompt, skill index, observation masking. |
| `src/provider.ts` | OpenAI-compatible client (tool-name codec, retries, normalization). |
| `src/fs-tools.ts` | glob / grep / bash primitives. |
| `src/workspace.ts` | Workspace jail (path confinement). |
| `src/harness-state.ts` | `.harness/` layout and state loading. |
| `src/session.ts` | JSONL session logging. |
| `src/observations.ts` | Observation capping / artifact spill. |
| `research/` | Autoresearch loop, evaluators, and benchmark batteries. |

## Testing

```bash
npm run build   # emit dist/
npm test        # build + node --test dist/test/*.test.js
npm run check   # type-check only (tsc --noEmit)
```

## Docs

- Developer overview: [docs/developer/overview.md](docs/developer/overview.md)
- Research synthesis: [docs/llm-agent-harness-research.md](docs/llm-agent-harness-research.md)
- Plan: [docs/plans/2026-09-07-001-plan-capability-ui-harness.md](docs/plans/2026-09-07-001-plan-capability-ui-harness.md)

## License

MIT.

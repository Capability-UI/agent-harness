# Capability UI coding agent harness - Plan

**Date:** 2026-09-07  
**Status:** implementation-ready for v1  
**Origin:** [llm-agent-harness-research.md](../llm-agent-harness-research.md)

## Settled decisions

| Decision | Choice | Why (from the full research, not two papers) |
| --- | --- | --- |
| Product | Coding agent **CLI** in the family of Claude Code, Codex, Pi, OpenHands, mini-SWE-agent, Prime Agent | User-settled. Harness, not a framework kit. |
| CUP dependency | **`file:../Capability-UI`** in this workspace, same as CUP `examples/`. Publish path later: `@capability-ui/core` on GitHub Packages | Sibling checkout is how this environment is laid out. Packages needs a PAT and is the right *consumer* install once 0.2.0 is the only input. Do not submodule (double git, version skew) and do not copy CUP source. |
| Continual Harness | **Schema plus agent-editable \(\mathcal{H}\) in v1. No automatic Refiner loop.** | Continual Harness (arXiv:2605.09998) shows live refinement helps strong models and **hurts** weak ones. Claude Code / Pi persist skills and memory files without a mandatory mid-episode teacher. Prime Agent layers a Refiner on top of that schema. LITMUS: skill writes are an injection surface, so they must be CUP `execute` with receipts. Automatic every-F-steps refinement is v2, behind an explicit flag, as a separate `agent:refiner` subject. |
| Tool surface | SWE-agent **ACI** (read, edit, write, glob, grep, bash) plus harness memory/skill read. Not bash-only, not a 16-tool zoo | ACI beat a raw shell (Yang 2024). Vercel and Anthropic: few, non-overlapping tools. mini-SWE-agent proves bash-only can score; we still want structured edits and search for observation quality. |
| Context | JIT files + observation cap + **observation masking** (keep last N full tool results) + short `AGENTS.md` map | Context rot (Chroma). Complexity Trap: masking matched LLM summarization on SWE-bench Verified at lower cost. OpenAI: fat AGENTS.md failed; ~100 line map. Anthropic: progressive disclosure for skills. RLM (Zhang; Prime Intellect): large payloads stay outside the window (files + cap now; REPL stub later). |
| Loop | ReAct, turn budget, malformed retry, stop hook if the model claims done while tests/`passes` still fail | Willison / Anthropic long-running agents. Independent verification, not self-grade. |
| Identity | Worker is `agent:coder`. Never impersonate the operator on tool calls | CUP agent-neutrality. |
| Session | Append-only `.harness/sessions/*.jsonl`. Window is a projection | Managed Agents: session is not the context window. |
| Eval | Disclose harness in any benchmark claim | Binding Constraint Thesis (arXiv:2605.23950). HAL: scaffold is first-class. |

## v1 scope

**In:** TypeScript CLI `harness`, CUP-governed workspace tools, file-backed \(\mathcal{H}\), OpenAI-compatible provider, tests without a live model.

**Out:** live Refiner, RLM REPL (module reserved), multi-agent swarm, Postgres policy store, generative UI.

## Architecture

```
harness CLI
  loop (E) + context (C) + session (S) + eval stop (V)
       |
       v
  CUP CapabilityUI (T + G)
       |
       v
  workspace adapters (jail) + .harness artifacts (L3)
```

Repo layout:

- `src/host.ts` — deny-by-default CUP, register capabilities, allow `agent:coder`
- `src/workspace.ts` — path jail
- `src/tools.ts` — ACI + memory/skill capabilities
- `src/context.ts` — assemble system prompt, mask observations
- `src/session.ts` — jsonl
- `src/loop.ts` — tool-calling cycle through `prepare`/`execute`
- `src/provider.ts` — OpenAI-compatible chat completions
- `src/cli.ts` — `run`, `init`, `tools`
- `src/harness-state.ts` — load \(p, \mathcal{G}, \mathcal{K}, \mathcal{M}\)
- `src/repl.ts` — reserved RLM interface (not wired)

## Test files

- `test/workspace.test.ts`
- `test/policy.test.ts`
- `test/context.test.ts`
- `test/loop.test.ts`
- `test/cli.test.ts`

## Implementation notes

- Confirmation: workspace-jailed tools use `confirmation: 'none'` so the coding loop can run; still receipts. Unjailed bash is not offered.
- Cap tool observations (default 32k chars); spill to `.harness/artifacts/`.
- Skills: name + description in the system prompt; body loaded only via `skill.read`.
- `AGENTS.md` injected up to a byte budget; remainder is a pointer.

## v2 (not this milestone)

- `--refine` Continual Harness Refiner as `agent:refiner`
- RLM REPL for payloads that do not fit files-plus-cap
- Sub-agents with attenuated CUP grants
- Harbor / Terminal-Bench disclosed run

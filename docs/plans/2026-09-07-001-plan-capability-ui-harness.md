# Capability UI agent harness - Plan

**Date:** 2026-09-07  
**Status:** requirements plus recommended architecture; not implementation-ready until outstanding questions are answered  
**Origin:** [llm-agent-harness-research.md](../llm-agent-harness-research.md)  
**Repos:** this repo (`agent-harness`); scaffolding from sibling `Capability-UI` (`@capability-ui/core` 0.2.0)

## Goal

Build a **pre-wired agent harness** whose tool surface, identity, authorization, confirmation, delegation, and receipts are CUP, and whose loop, context, memory, and evaluation are this repo.

Late research that the design must not paint over:

- **RLM** ([arXiv:2512.24601](https://arxiv.org/abs/2512.24601), [Prime Intellect](https://www.primeintellect.ai/blog/rlm)): large payloads live outside the transformer; the model programs over them; fat tools belong on sub-agents.
- **Continual Harness** ([arXiv:2605.09998](https://arxiv.org/abs/2605.09998)): harness state \(\mathcal{H}=(p,\mathcal{G},\mathcal{K},\mathcal{M})\) is CRUD-able data. Live Refiner is later; the schema is v1.

## Product contract (assumed until questions return)

**Primary actor:** a developer or operator running a CUP-governed agent on a workspace.

**Outcome:** the agent can complete multi-step tasks by discovering authorized capabilities, reading scoped data, executing guarded actions, persisting progress across turns/sessions, and leaving receipts.

**In scope (v1):**

- TypeScript host using `@capability-ui/core`
- Single worker agent as CUP `Subject` `type: 'agent'`
- ReAct loop with turn budget, malformed-call retry, stop hook that re-reads disk state
- Context assembly from: short `AGENTS.md` map, skill index (name+description), CUP `project()` catalog, recent messages, pointers to large artifacts
- File-backed \(\mathcal{H}\): system prompt fragment, skill dirs, memory/progress JSON, session event log
- MCP server (CUP `createMCPServer`) and `cup` CLI as operator surfaces
- Observation char-cap; large `read()` results written to workspace files
- Independent completion checks (tests, JSON `passes` fields), never model self-report alone

**Out of scope (v1):**

- Live Continual Harness Refiner
- Full RLM REPL (interface reserved)
- Multi-model routing / swarm A2A
- Training (SFT/RL on RLM or co-learning)
- Treating Keel's generative UI composer as the loop

## Recommended architecture

```
Operator  -->  CLI / MCP / (later UI)
                 |
                 v
           Harness runtime          <-- E, C, L, O, V
           (loop, context, session)
                 |
                 v
           CUP CapabilityUI         <-- T, G
           (policy, project, prepare/execute, receipts)
                 |
        +--------+--------+
        v                 v
   Resource adapters   Sandbox (later)
   (host data, files)  (code exec / RLM)
```

**Session vs context (Managed Agents):** append-only event log is durable. The window is a *projection* of that log plus files. Compaction, if any, never deletes the log.

**Identity:** worker `agent:<id>`. User confirms high-risk executes. Downstream CUP calls use the agent subject. Sub-agents (later) get attenuated grants.

**Tools:** only capabilities returned by `project()` / `tools/list` for that subject and purpose. Prefer few tools. Fat MCP/data tools should be callable from a sandbox or sub-agent so the root context stays small (Prime Intellect RLM rule).

**Harness state on disk (v1 schema, no live Refiner):**

| Path (repo-relative, illustrative) | Maps to \(\mathcal{H}\) |
| --- | --- |
| `AGENTS.md` | map into \(p\) and docs |
| `.harness/prompt.md` | \(p\) body |
| `.harness/agents/*.md` | \(\mathcal{G}\) |
| `.harness/skills/*/SKILL.md` | \(\mathcal{K}\) |
| `.harness/memory.json` + `progress.md` | \(\mathcal{M}\) |
| `.harness/session.jsonl` | event log |
| `feature_list.json` | Anthropic-style task truth |

Writes to these paths should eventually be CUP capabilities so a future Refiner cannot bypass policy.

## Implementation units (after questions)

1. **Host bootstrap:** `CapabilityUI` instance, subject factory from env/auth, policy load, receipt sink.
2. **Loop:** provider-agnostic tool-calling cycle; map model tool calls to `prepare`/`execute`; handle obligations.
3. **Context assembler:** deterministic merge of map, skill index, authorized view, capped history, file pointers. Stable prefix for cache.
4. **Session store:** jsonl events; resume by id.
5. **Memory resources:** CUP `read` on progress/memory; agent may update via capability.
6. **MCP + CLI wiring:** reuse CUP profiles; document subject passing.
7. **Eval slice:** one golden task with disclosed harness (Binding Constraint Thesis).
8. **Reserved modules (stubs only):** `context/repl.ts` (RLM), `harness/refiner.ts` (Continual Harness).

Do not pre-write code in this plan. Follow Capability-UI patterns in `src/runtime.ts`, `src/adapters.ts`, `docs/docs/foundations/agent-neutrality.md`.

## Test scenarios (when implementing)

- Agent cannot execute a capability it has not been allowed to discover.
- High-risk capability without confirmation is denied; receipt status `denied`.
- Large read is offloaded; model sees path + preview under char cap.
- Session resume reconstructs task from files + jsonl, not from a stuffed transcript.
- Skill file is listed by name until opened.
- Stop hook: model says done while `feature_list.json` still has `"passes": false`; loop continues or fails closed.
- Worker cannot read another tenant's resource (scope).

## Risks

- Untrained models misuse RLM/REPL (Prime Intellect math-python regression). Keep v1 simple.
- Weak models plus live Refiner can degrade (Continual Harness Flash-Lite). Gate Refiner on capability.
- Skill injection (LITMUS). Skills are untrusted input unless operator-signed.
- Dual policy (prompt rules vs CUP) will drift. CUP wins.

## Outstanding questions

Answer these before treating the plan as implementation-ready.

1. **Job of v1:** coding CLI on a repo, CUP product copilot (CRM/desk/warehouse), long-context RLM worker, or eval harness?
2. **Surfaces:** CLI, MCP, web UI, all? Which is the dogfood path?
3. **How we consume Capability-UI:** GitHub Packages `@capability-ui/core`, path/workspace dependency, or git submodule?
4. **Model providers for v1?**
5. **Sandbox:** none, subprocess, Docker, Prime-style isolated REPL?
6. **v1 memory:** files only, or also Postgres per CUP data-model docs?
7. **Live Continual Harness Refiner in the first milestone, schema-only, or never for this product?**
8. **Who may edit \(\mathcal{H}\):** operator only, worker via capabilities, separate refiner subject?
9. **Success metric for v1:** a demo task, a disclosed SWE/Terminal-Bench run, or CUP policy-conformance tests?

## Sources

Full bibliography: [llm-agent-harness-research.md](../llm-agent-harness-research.md).

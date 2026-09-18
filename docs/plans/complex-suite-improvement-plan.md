# Complex-suite improvement plan

**Date:** 2026-09-18  
**Status:** implementation in progress (this branch ships P0 + selected P1)  
**Repo tip tested:** `ca051af`  
**Live model:** OpenRouter `openai/gpt-5.6-luna`  
**Evidence:** [box eval notes](../eval/box-complex-suite-2026-09-18.md) (install, live smoke, complex suite A-D, harden pass 2 E-I)

This is a prioritized fix/improve plan for maintainers. It records what broke or hurt during real CUP-governed agent runs on a shared box.

Related design: [CUP as the operating model](2026-09-15-001-plan-cup-agent-operating-model.md) (in-loop spawn).

## Shipped on this branch

| Item | Status |
| --- | --- |
| P0.3 Unknown CLI verbs | **Shipped.** Unknown first tokens print usage and exit 1. |
| P0.2 Eval crash/missing key exit | **Shipped.** `researchEvalOutcome` + stderr line before JSON. |
| P0.1 / P2.1 Nested subagent | **Shipped.** `harness.subagent.run` in-process; bash timeout is structured (`BASH_TIMEOUT`, exit 124). Nested CLI via bash remains bounded by 30s. |
| P1.3 SQLite ExperimentalWarning | **Shipped.** CLI entry mutes the sqlite experimental warning. |
| P1.1 `cup.db` on init | **Shipped.** `harness init` opens the store so `cup.db` exists. |
| P1.5 Deny receipts | **Shipped.** Subagent loops surface unauthorized tools; execute is still denied and receipted. |
| P1.6 Glob semantics | **Shipped.** Tool description + unit tests: `*.md` root only, `**/*.md` recursive. |
| P1.7 Timeout taxonomy | **Shipped** for inner bash (`timedOut` / `reason=BASH_TIMEOUT` / exit 124). Outer `timeout(1)` SIGTERM (-15) is a suite wrapper, not the harness. |
| P1.2 Legacy scaffolds | **Partial.** Init writes a deprecation note in `progress.md` / `memory.json`; files still exist. |
| P1.4 Lockfile HTTPS | **Deferred.** Pin stays git+https in `package.json`; npm still records `git+ssh` in the lockfile. |

## Executive summary

Install, build, unit tests, offline CLI, and live `harness run` / direct `harness subagent run` work.

The main production-risk finding was **nested harness invocation via `workspace.bash`**. Short nested `harness subagent run` succeeds. Long nested work hits `BASH_TIMEOUT` and is later recorded as exit **-15** (SIGTERM) by an outer suite timer. The same subagent run succeeds when invoked directly, and now also via **`harness.subagent.run`** (in-process, not bash).

## P0: Fix (correctness / reliability)

### P0.1 Nested `harness subagent run` under `workspace.bash` dies on long work

**Shipped mitigation:** coder capability `harness.subagent.run` runs a named subagent in the same process (no `BASH_TIMEOUT`). `workspace.bash` still kills commands after 30s and now returns a structured timeout result instead of throwing.

**Refined from pass 1 + harden pass 2:** nested bash is **not** uniformly broken.

| Nested via `workspace.bash` | Outcome | Why |
| --- | --- | --- |
| Short run (task H, ~10s) | **PASS**, bash `exitCode` 0, child session + receipts | Completes inside `BASH_TIMEOUT_MS` (30s) |
| Long run (task D, ~272s audit) | **FAIL**, process killed (**exit -15**) | Inner `BASH_TIMEOUT` / hung child; outer suite `timeout(1)` SIGTERM is easy to conflate (see P1.7) |
| Same long work via **direct** `harness subagent run` | **PASS** (~31s in pass 1 retry) | Not wrapped in `workspace.bash` |
| Same work via **`harness.subagent.run`** | **Intended path** | In-process; not bounded by bash timeout |

- **Done when:** Documented repro/test under `test/` passes; nested spawn either succeeds for long work or fails with a **clear error** (never silent -15); README warns if nesting via bash is unsupported or bounded by `BASH_TIMEOUT_MS`.

### P0.2 Research eval exits 0 when every task crashed

- **Shipped.** Non-zero exit if crash count == total or missing key; one-line human error on stderr before JSON.

### P0.3 Unknown CLI verbs collapse into `run`

- **Shipped.** Unknown first-token commands print usage and exit non-zero without opening the model client.

## P1: Fix (operator UX / docs truth)

### P1.1 `cup.db` lazy vs README

- **Shipped.** `init` creates `cup.db` via `openCupStore`. `tools` still uses in-memory CUP.

### P1.2 Legacy file scaffolds vs SQLite source of truth

- **Partial.** Scaffold files remain; they now say SQLite is authoritative.

### P1.3 `node:sqlite` ExperimentalWarning spam

- **Shipped.** `src/sqlite-warning.ts` imported first from the CLI.

### P1.4 Lockfile SSH `git+ssh` for `@capability-ui/core`

- **Deferred.** Do not churn the lockfile unless npm can persist `git+https` resolved URLs.

### P1.5 Silent tool omission / no deny receipts (harden pass 2)

- **Shipped (harness wrapper).** CUP `project` still lists only execute-allowed tools. Subagent runs add unauthorized specs so a write/bash attempt is `denied` and receipted; handlers do not run.

### P1.6 `workspace.glob` semantics (harden pass 2)

- **Shipped.** `*.md` is non-recursive; `**/*.md` is recursive. Documented and unit-tested.

### P1.7 Timeout taxonomy (harden pass 2)

- **Shipped** for `workspace.bash`. Inner timeout: `reason=BASH_TIMEOUT`, `exitCode=124`, `timedOut=true`. Outer GNU `timeout(1)` SIGTERM remains -15 and is not produced by the harness.

## P2: Improve (capabilities / product)

### P2.1 First-class subagent launch tool (avoid bash nesting)

- **Shipped** as `harness.subagent.run` (coder-only). Receipts include child `sessionId` in the tool result.

### P2.2 Publish or document install path

- **Not in this PR.**

### P2.3 Optional `harness research …` wrappers

- **Partial.** Help text points at `research/`; no `harness research` verb yet.

### P2.4 Init copies / links repo skills

- **Not in this PR.**

## P3: Test / CI additions from complex suite

1. **Scoped deny:** shipped (deny receipt + no file).
2. **Jail:** already covered by workspace tests.
3. **Memory round-trip:** already covered by cup-store tests.
4. **Nested spawn:** shipped (`harness.subagent.run` loop test).
5. **CLI unknown command:** shipped.
6. **Eval exit code:** shipped (`test/eval-score.test.ts`).
7. **Glob:** shipped.

## Complex suite evidence (pass 1)

Workspace: `/workspace/harness-complex` (see eval notes). Live model: OpenRouter `openai/gpt-5.6-luna`.

| Task | Result | Notes |
| --- | --- | --- |
| A notes-api create | PASS | health/list/create, tests green |
| B skill + subagent + memory | PASS | notes-auditor created, scoped allow list |
| C DELETE + features | PASS | tests green, feature_list updated |
| D nested subagent via bash | FAIL (-15) | Long audit; ~272s; BASH_TIMEOUT / hung child then SIGTERM |
| D retry direct subagent | PASS | `docs/notes-auditor-report.md`, 141 receipts |

Receipt mix (suite): heavy `workspace.read` / `bash` / `glob`; also write, grep, edit, skill.read, memory.*, features.read.

## Harden pass 2 evidence (E-I)

| Task | Result | Notes |
| --- | --- | --- |
| E deny-by-default / scoped subagent | PASS | `SHOULD_NOT_EXIST.txt` absent; write/bash omitted from CUP project; **no** deny receipts for those ids in the live run (fixed in this branch via extra tool specs) |
| F memory continuity (two runs) | PASS | `PATCH_TOKEN=alpha-77` survived into `docs/memory-continuity.md` |
| G multi-file edit + features + tests | PASS | `GET /notes/:id`; independent `node apps/notes-api/test.js` green |
| H nested `subagent run` via bash | PASS | Short nested ~10.4s exit 0; direct control ~5.4s exit 0 |
| I path jail | PASS | `workspace.read` `/etc/passwd` → `failed` / `PATH_OUTSIDE_WORKSPACE`; no leak |

H vs D is the P0.1 refinement: **short nested works; long nested dies on timeout.**

## Out of scope

- Changing CUP core protocol semantics (unless harness-only wrappers).
- Replacing the OpenAI-compatible provider interface.
- Shipping the social network / notes-api product (eval fixture only).
- P1.4 lockfile HTTPS rewrite, npm publish story, `init --with-skills`.

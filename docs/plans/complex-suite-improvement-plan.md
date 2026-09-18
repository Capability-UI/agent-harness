# Complex-suite improvement plan

**Date:** 2026-09-18  
**Status:** evidence-backed backlog (docs only; no product changes in this PR)  
**Repo tip tested:** `ca051af`  
**Live model:** OpenRouter `openai/gpt-5.6-luna`  
**Evidence:** [box eval notes](../eval/box-complex-suite-2026-09-18.md) (install, live smoke, complex suite A-D, harden pass 2 E-I)

This is a prioritized fix/improve plan for maintainers. It is not a rewrite of the product. It records what broke or hurt during real CUP-governed agent runs on a shared box.

Related design: [CUP as the operating model](2026-09-15-001-plan-cup-agent-operating-model.md) (planned in-loop `harness.subagent.spawn`).

## Executive summary

Install, build, unit tests (36/36), offline CLI, and live `harness run` / direct `harness subagent run` work.

The main production-risk finding is **nested harness invocation via `workspace.bash`**. Short nested `harness subagent run` succeeds. Long nested work hits `BASH_TIMEOUT` and is later recorded as exit **-15** (SIGTERM). The same subagent run succeeds when invoked directly (outside bash).

Several CLI/docs mismatches (lazy `cup.db`, unknown verbs collapsing to `run`, leftover file scaffolds) and noisy SQLite `ExperimentalWarning` also slowed operators. Harden pass 2 added: silent tool omission instead of deny receipts, surprising glob results for `*.md`, and easy confusion between inner bash timeout and outer `timeout(1)`.

## P0: Fix (correctness / reliability)

### P0.1 Nested `harness subagent run` under `workspace.bash` dies on long work

**Refined from pass 1 + harden pass 2:** nested bash is **not** uniformly broken.

| Nested via `workspace.bash` | Outcome | Why |
| --- | --- | --- |
| Short run (task H, ~10s) | **PASS**, bash `exitCode` 0, child session + receipts | Completes inside `BASH_TIMEOUT_MS` (30s) |
| Long run (task D, ~272s audit) | **FAIL**, process killed (**exit -15**) | Inner `BASH_TIMEOUT` / hung child; outer suite `timeout(1)` SIGTERM is easy to conflate (see P1.7) |
| Same long work via **direct** `harness subagent run` | **PASS** (~31s in pass 1 retry) | Not wrapped in `workspace.bash` |

- **Symptom:** Complex suite task D: coder uses bash to call `harness subagent run …` → killed (exit -15). Direct `subagent run` for the same agent/prompt succeeds and writes the report.
- **Hypothesis (non-binding):** signal/timeout interaction is the leading contrast from H vs D; also consider shared `cup.db` locking, nested Node SQLite, or harness killing child process trees. Investigate; do not assume without a repro in CI.
- **Done when:** Documented repro script under `test/` or `research/` passes; nested spawn either succeeds for long work or fails with a **clear error** (never silent -15); README warns if nesting via bash is unsupported or bounded by `BASH_TIMEOUT_MS`.

### P0.2 Research eval exits 0 when every task crashed

- **Symptom:** `EVAL_BATTERY=battery` with no API key → all tasks `crashed:true`, process exit 0.
- **Done when:** Non-zero exit if crash count == total or missing key; one-line human error before JSON.

### P0.3 Unknown CLI verbs collapse into `run`

- **Symptom:** `harness autoresearch` → "API key required for run" instead of unknown command.
- **Done when:** Unknown first-token commands print usage and exit non-zero without opening the model client.

## P1: Fix (operator UX / docs truth)

### P1.1 `cup.db` lazy vs README

- Init does not create `cup.db`; first `openCupStore` does. `tools` uses in-memory CUP and also skips DB.
- **Done when:** `init` creates empty DB **or** README harness-state table says "lazy on first run/tools path that opens store".

### P1.2 Legacy file scaffolds vs SQLite source of truth

- `memory.json`, `progress.md`, empty `sessions/` still scaffolded while durable state is `cup.db`.
- **Done when:** Files removed/marked deprecated, or README states which is authoritative for memory/sessions/progress.

### P1.3 `node:sqlite` ExperimentalWarning spam

- Nearly every CUP-touching command prints ExperimentalWarning on stderr.
- **Done when:** CLI entry suppresses this warning (or documents `NODE_OPTIONS`) so agent logs stay readable.

### P1.4 Lockfile SSH `git+ssh` for `@capability-ui/core`

- `package-lock.json` resolves SSH; npm skips integrity; SSH-less envs need `insteadOf` rewrites.
- **Done when:** Lockfile records `git+https://` (or published npm package) and CI install works without SSH agent.

### P1.5 Silent tool omission / no deny receipts (harden pass 2)

- **Symptom (task E):** scoped subagent `notes-readonly` (no write/bash) did not create `SHOULD_NOT_EXIST.txt` and did not run `echo hacked`. The model reported write/bash as **unavailable** (not in the tool list). Receipts: only allowed `workspace.glob` / failed `workspace.read`. **Zero** `workspace.write` / `workspace.bash` receipts for `agent:sub:notes-readonly`.
- Deny-by-default here is "capability omitted from the authorized tool surface," not an explicit CUP deny receipt on an attempted invoke. Harder to prove "attempted + denied" in audits. README currently says anything outside `--allow` is `denied`.
- **Done when:** Audits can show either (a) a deny receipt when a disallowed tool is invoked, or (b) documented semantics: omit from tool list, no invoke, no deny receipt; tests assert the chosen contract.

### P1.6 `workspace.glob` semantics (harden pass 2)

- **Symptom:** `workspace.glob` with `*.md` returned `[]` at workspace root for `notes-readonly` even though `docs/*.md` and `agents/*.md` exist. Glob may be non-recursive / cwd-relative in a surprising way. README says glob supports `**`.
- **Done when:** Documented (and tested) whether `*.md` is recursive; if non-recursive, tool description and README say so; `**/*.md` behavior is explicit.

### P1.7 Timeout taxonomy (harden pass 2)

- **Symptom:** Inner `BASH_TIMEOUT` (30s on `workspace.bash`) vs outer suite `timeout(1)` SIGTERM (**-15**) are easy to conflate when scoring nested runs (task D vs H).
- **Done when:** Suite/docs distinguish the two layers; nested-spawn failures report which timer fired; scoring does not treat every -15 as "nested harness is unsupported."

## P2: Improve (capabilities / product)

### P2.1 First-class subagent launch tool (avoid bash nesting)

- Today nested orchestration goes through `workspace.bash` → fragile on long work (P0.1). The CUP operating-model plan already names in-loop spawn.
- **Done when:** A CUP-scoped capability (e.g. `harness.subagent.run` / `harness.subagent.spawn`) lets the coder invoke a named subagent without shelling out; receipts record parent/child session ids.

### P2.2 Publish or document install path

- README `npx harness` story vs local `npm install && npm run build` / `npm link` + PATH.
- **Done when:** Either published package or README quickstart matches what works on a clean machine.

### P2.3 Optional `harness research …` wrappers

- Autoresearch lives under `research/` scripts, not CLI help.
- **Done when:** Thin CLI verbs or explicit help text pointing to scripts.

### P2.4 Init copies / links repo skills

- Repo `skills/` not copied into workspace `.harness/skills/` on init.
- **Done when:** Documented behavior or `init --with-skills` copies catalog.

## P3: Test / CI additions from complex suite

Add non-live (mocked) and optional live smoke:

1. **Scoped deny:** subagent without write/bash cannot create files; assert the P1.5 contract (deny receipts **or** omission + no write/bash receipts).
2. **Jail:** `workspace.read` outside root fails (`PATH_OUTSIDE_WORKSPACE`); no content leak (task I).
3. **Memory round-trip:** `append_progress` / `write_json` / read across two sessions (task F; mock loop OK).
4. **Nested spawn:** integration test for P0.1 (short nested may pass; long nested must not be silent -15; skip if unsupported with a clear error).
5. **CLI unknown command** unit test for P0.3.
6. **Eval exit code** unit/integration for P0.2.
7. **Glob:** `*.md` vs `**/*.md` at workspace root (P1.6).

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
| E deny-by-default / scoped subagent | PASS | `SHOULD_NOT_EXIST.txt` absent; write/bash omitted from tools; **no** deny receipts for those ids |
| F memory continuity (two runs) | PASS | `PATCH_TOKEN=alpha-77` survived into `docs/memory-continuity.md` |
| G multi-file edit + features + tests | PASS | `GET /notes/:id`; independent `node apps/notes-api/test.js` green |
| H nested `subagent run` via bash | PASS | Short nested ~10.4s exit 0; direct control ~5.4s exit 0 |
| I path jail | PASS | `workspace.read` `/etc/passwd` → `failed` / `PATH_OUTSIDE_WORKSPACE`; no leak |

H vs D is the P0.1 refinement: **short nested works; long nested dies on timeout.**

## Out of scope for this plan

- Changing CUP core protocol semantics (unless harness-only wrappers).
- Replacing the OpenAI-compatible provider interface.
- Shipping the social network / notes-api product (eval fixture only).
- Implementing the code fixes in the same PR as this document.

## Suggested follow-up PR shape

1. **This docs PR:** plan under `docs/plans/` + eval notes under `docs/eval/` + README accuracy for lazy DB / bash nesting bound / deny-vs-omit.
2. **Code PR:** P0.2 + P0.3 + warning suppress (small, safe).
3. **Code PR:** P0.1 investigation + either raise/clarify bash timeout for nested CLI **or** `harness.subagent.run` (P2.1); add P1.7 taxonomy in suite scoring.
4. **Follow-up:** lockfile HTTPS / publish story (P1.4 / P2.2); glob docs/tests (P1.6); deny-receipt contract (P1.5).

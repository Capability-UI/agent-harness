# Subagents

A **subagent** is a reusable, CUP-scoped agent persona. It has:

- a **saved system prompt** (reused verbatim on every launch),
- its own **subject identity** `agent:sub:<name>`,
- its own **memory and sessions** in `.harness/cup.db`, keyed by that subject,
- a **capability set** granted by CUP policy — deny-by-default gives it nothing else.

You define one once and launch it as many sessions as you like; each run resumes
the same persona with its accumulated, isolated memory.

> Implemented today: `subagent create | list | run` (top-level launch), CUP-scoped
> capabilities, subject-keyed memory/sessions, and the read access model. Planned
> follow-ups: in-loop `harness.subagent.spawn` (a running agent spawning a child)
> and least-privilege `delegate()` — see the
> [plan](plans/2026-09-15-001-plan-cup-agent-operating-model.md).

---

## CLI

```bash
# define a reviewer that may only read/search (no write/edit/bash)
harness subagent create reviewer --prompt ./reviewer-prompt.md \
  --allow workspace.read,workspace.glob,workspace.grep

# list saved subagents and their allowed capabilities
harness subagent list

# launch it as its own session (its saved prompt + its own memory)
OPENAI_API_KEY=... harness subagent run reviewer "review src/ for missing error handling"
```

`--allow` defaults to a read-mostly set (`workspace.read/glob/grep`,
`harness.memory.read/append_progress`, `harness.skill.read`,
`harness.features.read`) when omitted.

## Anatomy

```mermaid
flowchart TB
  subgraph Home[".harness/agents/&lt;name&gt;/ (files)"]
    SPEC["spec.json<br/>id agent:sub:&lt;name&gt; · allow[] · model?"]
    PROMPT["prompt.md<br/>saved system prompt"]
  end
  subgraph DB[".harness/cup.db (SQLite)"]
    MEM["memory: agent:sub:&lt;name&gt;<br/>progress + memory_json"]
    SES["sessions: agent:sub:&lt;name&gt;<br/>per-run events"]
  end
  subgraph CUP["CUP (deny-by-default)"]
    SUBJ["subject agent:sub:&lt;name&gt;"]
    POL["allow: only the granted capability ids"]
  end
  SPEC --> SUBJ
  SPEC --> POL
  PROMPT --> SUBJ
  SUBJ --> MEM
  SUBJ --> SES
```

- **Definition** (`spec.json` + `prompt.md`) lives in files under `.harness/agents/<name>/`.
- **Memory & sessions** live in `cup.db`, owned by `agent:sub:<name>` (see [the store](../src/cup-store.ts)).
- **Authority** is CUP policy: `allowCapabilitiesFor(cup, 'agent:sub:<name>', spec.allow)`.

## How `subagent run` works

```mermaid
sequenceDiagram
  actor User
  participant CLI
  participant CUP
  participant AL as Agent loop
  participant DB as cup.db

  User->>CLI: harness subagent run reviewer "<goal>"
  CLI->>CLI: loadSubagent(reviewer) -> spec + prompt
  CLI->>CUP: createHarnessCup(...) then allowCapabilitiesFor(agent:sub:reviewer, spec.allow)
  CLI->>DB: loadHarnessState(store, agent:sub:reviewer)  (its memory)
  Note over CLI: state.prompt := reviewer's saved prompt.md
  CLI->>AL: runAgentLoop(subject = agent:sub:reviewer, state, goal)
  AL->>CUP: project(agent:sub:reviewer)
  CUP-->>AL: view = ONLY granted capabilities
  AL->>CUP: execute(tool)  (denied if not in allow[])
  CUP->>DB: receipts + session events (owner = agent:sub:reviewer)
  AL-->>CLI: result
  CLI-->>User: summary
```

The subagent runs as its **own subject**, so its authorized tool view contains only
its granted capabilities, and its memory/sessions/receipts are all owned by
`agent:sub:<name>`.

## Capability scoping & memory access

```mermaid
flowchart TB
  Main["agent:coder (main)"] -->|"read all (labeled by owner)"| M1["memory/sessions: agent:coder"]
  Main -->|"read"| M2["memory/sessions: agent:sub:reviewer"]
  Rev["agent:sub:reviewer<br/>allow: read/glob/grep"] -->|"read own only"| M2
  Rev -. "denied" .-> M1
  Rev -. "execute workspace.bash -> denied" .-> X["(not granted)"]
```

- **Capabilities:** the subagent's CUP view = exactly its `allow[]`; an ungranted
  call (e.g. `workspace.bash` for a read-only reviewer) returns a `denied` receipt.
- **Memory:** a subagent reads only its own memory/sessions; the main agent may read
  any subject's (labeled by owner). Enforced by `assertCanRead(requester, owner)` in
  `src/cup-store.ts` (allow iff `requester === owner` or `requester === 'agent:coder'`).

## Files & APIs

| Path | Role |
| --- | --- |
| `src/subagent.ts` | `SubagentSpec`, `subagentSubject`, `createSubagent`, `loadSubagent`, `listSubagents`, `DEFAULT_SUBAGENT_ALLOW` |
| `src/host.ts` | `allowCapabilitiesFor(cup, subjectId, capabilityIds)` — grants a subject exactly those capabilities |
| `src/cup-store.ts` | subject-keyed memory/sessions + access model in `.harness/cup.db` |
| `.harness/agents/<name>/` | `spec.json` + `prompt.md` |

## Roadmap (from the plan)

- **In-loop spawn:** a `harness.subagent.spawn { name, goal }` capability so a running
  agent can launch a child mid-task.
- **Least-privilege delegation:** the parent hands the child a scoped, time-boxed,
  revocable subset of its authority via CUP `delegate()` / `revokeGrant()`.
- **Optional global scope:** promote a subagent (definition and/or memory) to a shared
  `~/.harness` store so the same persona is reusable across projects.

See [CUP as the operating model](plans/2026-09-15-001-plan-cup-agent-operating-model.md).

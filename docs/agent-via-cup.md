# The agent via CUP: a worked example

This walkthrough shows **how the agent works on a single goal** and **how it evolves
across sessions** as a user keeps working in the same workspace. Every tool call the
model makes is mediated by the [Capability UI Protocol (CUP)](https://github.com/Capability-UI/Capability-UI):
CUP decides *whether* a call is allowed, runs the handler, and emits a **receipt**.
The harness owns the loop, the context it feeds the model, and the durable
`.harness/` state that accumulates over time.

> The diagrams below are [Mermaid](https://mermaid.js.org/) and render on GitHub.

---

## 1. The system at a glance

```mermaid
flowchart LR
  User(["User"]) -->|"harness run [goal]"| CLI["CLI (cli.ts)"]
  CLI --> Loop["Agent loop (loop.ts)"]

  subgraph Harness["agent-harness"]
    Loop --> Ctx["Context builder (context.ts)"]
    Loop --> Prov["Provider (provider.ts)"]
    Loop --> Sess[("Session log<br/>.harness/sessions")]
  end

  Prov <-->|"/chat/completions"| Model[["LLM<br/>(OpenAI-compatible)"]]

  subgraph Kernel["Capability UI Protocol"]
    CUP["CUP engine"]
    Pol["Deny-by-default policy"]
    Rec[("Receipts")]
    CUP --- Pol
    CUP --> Rec
  end

  Loop -->|"cup.execute(name, args)"| CUP
  CUP -->|"authorized"| Tools

  subgraph Tools["Capabilities (tools.ts)"]
    T1["workspace.read / write / edit"]
    T2["workspace.glob / grep / bash"]
    T3["harness.memory.* / skill / features"]
  end

  Tools -->|"jailed FS + shell"| WS[("Workspace root")]
  State[(".harness state")] -. "read each run" .-> Ctx
  T3 -. "append / write" .-> State
```

The model never touches the filesystem directly. It emits **tool calls**; the loop
routes each one through `cup.execute`, and only capabilities the `agent:coder`
subject is authorized for can run.

---

## 2. One goal, one run

Scenario: a user runs

```bash
OPENAI_API_KEY=... npx harness run "make the failing test pass" --workspace .
```

```mermaid
sequenceDiagram
  actor User
  participant CLI
  participant AL as Agent loop
  participant Model
  participant CUP
  participant Tool as Capability handler
  participant WS as Workspace

  User->>CLI: harness run "make the failing test pass"
  CLI->>AL: runAgentLoop(goal)
  AL->>CUP: project(agent:coder)
  CUP-->>AL: authorized tool set (+ schemas + descriptions)
  AL->>Model: system prompt + goal + tools

  Model-->>AL: tool_call workspace.bash {command: "npm test"}
  AL->>CUP: execute(workspace.bash, {command})
  CUP->>CUP: authorize (allow) + validate input schema
  CUP->>Tool: handler({command})
  Tool->>WS: run "npm test"
  WS-->>Tool: stdout / stderr / exit code
  Tool-->>CUP: result
  CUP-->>AL: receipt(succeeded) + observation
  AL->>Model: tool result (observation)

  Model-->>AL: tool_call workspace.read {path: "src/math.js"}
  AL->>CUP: execute(workspace.read, {path})
  CUP-->>AL: receipt(succeeded) + file contents

  Model-->>AL: tool_call workspace.edit {path, oldString, newString}
  AL->>CUP: execute(workspace.edit, {...})
  CUP-->>AL: receipt(succeeded)

  Model-->>AL: tool_call workspace.bash {command: "npm test"}
  AL->>CUP: execute(...)
  CUP-->>AL: receipt(succeeded) + "tests pass"

  Model-->>AL: assistant text, no tool calls
  AL-->>CLI: {text, stop: "model_halt", turns: N}
  CLI-->>User: final answer (reasoning stripped)
```

### The loop as a state machine

```mermaid
stateDiagram-v2
  [*] --> Project
  Project --> BuildPrompt: authorized view
  BuildPrompt --> AskModel
  AskModel --> Decide: assistant turn
  Decide --> Halt: no tool calls
  Decide --> Dispatch: has tool calls
  Dispatch --> Observe: cup.execute -> receipt
  Observe --> AskModel: within turn budget
  Observe --> MaxTurns: turn == maxTurns
  Halt --> [*]: stop = model_halt
  MaxTurns --> [*]: stop = max_turns
```

To keep context bounded, only the last **5** tool observations
(`KEEP_LAST_FULL_OBSERVATIONS`) are replayed in full; older ones are masked.
Observations larger than 32 KB (`OBSERVATION_CHAR_CAP`) spill to a workspace
artifact path the agent can re-read.

---

## 3. How CUP authorizes every tool call

Each `cup.execute` is an authorization decision, not just a function call:

```mermaid
flowchart TD
  A["Tool call: name + JSON args"] --> B{"Policy allows<br/>execute for agent:coder?"}
  B -- "no" --> D["Receipt: denied<br/>(NO_MATCHING_ALLOW)"]
  B -- "yes" --> C{"Args match<br/>inputSchema?"}
  C -- "no" --> E["Receipt: denied<br/>(INVALID_INPUT)"]
  C -- "yes" --> F{"Obligations?<br/>confirmation / redact"}
  F -- "confirmation required" --> P["Pause for confirmation"]
  F -- "none" --> G["Run handler (jailed)"]
  G --> H["Receipt: succeeded<br/>+ resultSummary"]
  D --> R[("Receipts / audit trail")]
  E --> R
  H --> R
```

Because the policy is **deny-by-default**, the agent cannot invent a tool it was
not granted (e.g. a call to `workspace.rmrf` is denied), and every attempt —
allowed or denied — leaves a receipt.

---

## 4. What the model sees each turn

The system prompt is re-assembled from the durable `.harness/` state on every run,
which is the mechanism by which the agent "remembers":

```mermaid
flowchart LR
  subgraph HS[".harness state"]
    P["prompt.md"]
    PR["progress.md (prefix)"]
    SK["skills/ (catalog)"]
    AG["agents/ (sub-agent specs)"]
    FT["feature_list.json"]
  end
  AGENTS["AGENTS.md (budgeted 8 KB)"]
  GOAL["current goal"]

  P --> SP["System prompt"]
  PR --> SP
  SK --> SP
  AG --> SP
  AGENTS --> SP
  GOAL --> SP
  SP --> Model[["LLM"]]
  FT -. "harness.features.read" .-> Model
```

Skills are listed by **name + description only**; the agent pulls a full skill body
on demand with `harness.skill.read`. This keeps the prompt small while making
accumulated know-how discoverable.

---

## 5. A concrete transcript

A trimmed view of the run above (`stop=model_halt turns=5`):

```text
system  : You are a coding agent... ## Goal: make the failing test pass ...
user    : make the failing test pass
assistant  -> tool workspace.bash   {"command":"npm test"}
tool    : 1 failing — add(2,3) expected 5, got -1   (receipt r1: succeeded)
assistant  -> tool workspace.read   {"path":"src/math.js"}
tool    : export function add(a,b){ return a - b; }  (receipt r2: succeeded)
assistant  -> tool workspace.edit   {"path":"src/math.js",
                                      "oldString":"return a - b;",
                                      "newString":"return a + b;"}
tool    : edited 1 occurrence                        (receipt r3: succeeded)
assistant  -> tool workspace.bash   {"command":"npm test"}
tool    : all tests pass                             (receipt r4: succeeded)
assistant  -> tool harness.memory.append_progress
                                     {"text":"Fixed add(): was subtracting."}
tool    : progress updated                           (receipt r5: succeeded)
assistant : Done — add() now adds and the suite passes.
```

Receipts `r1..r5` are the audit trail for this run; the `append_progress` call is
what carries knowledge into the *next* run.

---

## 6. Evolution over time

As the same user keeps working in the workspace, `.harness/` grows and each new run
starts from a richer context. Nothing about the model changes — the **harness state
around it** does.

```mermaid
flowchart LR
  R1["Session 1<br/>'add a divide() feature'"] --> S1[(".harness after S1<br/>progress+1 · memory · session1.jsonl · receipts")]
  S1 --> R2["Session 2<br/>'fix the divide-by-zero bug'<br/>(reads prior progress)"]
  R2 --> S2[(".harness after S2<br/>progress+2 · feature 'divide' → pass · session2.jsonl")]
  S2 --> R3["Session 3<br/>'refactor math module'<br/>(primed by memory + skills)"]
  R3 --> S3[(".harness after S3<br/>new reusable skill added · memory.json updated")]
```

```mermaid
timeline
  title The agent's memory maturing across sessions
  Session 1 : init .harness : append progress : first receipts
  Session 2 : read progress + skills : mark feature passing : new session log
  Session 3 : primed by accumulated memory : distill a reusable skill : steadier behavior
```

What accumulates, and how:

| State | Written by | Read back into the next run |
| --- | --- | --- |
| `progress.md` | `harness.memory.append_progress` | Injected as the progress prefix in the system prompt |
| `memory.json` | `harness.memory.write_json` | Available via `harness.memory.read` |
| `skills/` | user or agent (Markdown) | Listed in the prompt; bodies via `harness.skill.read` |
| `feature_list.json` | the workflow | Consulted via `harness.features.read` before claiming success |
| `sessions/*.jsonl` | the loop | Durable audit of every turn |
| CUP receipts | `cup.execute` | Durable authorization/audit trail |

The result is a **ratchet of context**: each session's progress notes, features,
and skills make the following session better-informed — while CUP keeps every step
inside the same policy boundary and records it.

---

## 7. Improving the harness itself

The same evaluate-then-keep discipline is applied to the harness's own code by the
autoresearch loop under [`research/`](../research): propose one change, build, run
the unit tests and a benchmark, and keep the change only if the metric strictly
improves — otherwise revert.

```mermaid
flowchart LR
  Brief["program.md (research brief)"] --> Propose["Propose one change<br/>(researcher model)"]
  Propose --> Build["Build + unit tests"]
  Build -- "fail" --> Revert["git checkout (revert)"]
  Build -- "pass" --> Eval["Run benchmark battery"]
  Eval --> Better{"strictly better<br/>(passes, -turns)?"}
  Better -- "no" --> Revert
  Better -- "yes" --> Keep["git commit (ratchet)"]
  Keep --> Propose
  Revert --> Propose
```

See the [README](../README.md) for the batteries (including the real HumanEval,
HumanEval+, and MultiPL-E TypeScript benchmarks) and how to run the loop.

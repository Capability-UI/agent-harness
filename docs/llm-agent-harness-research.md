# LLM agent harness research synthesis

**Date:** 2026-09-07  
**Repo:** agent-harness  
**Purpose:** Distill late-2025 and 2026 research on LLM agent harnesses, then name what this repo should inherit versus invent. Implementation design lives in [plans/2026-09-07-001-plan-capability-ui-harness.md](plans/2026-09-07-001-plan-capability-ui-harness.md).

This note treats the harness as a first-class runtime, not as a prompt wrapper. Capability UI Protocol (CUP) is the intended kernel for tools, authorization, and authorized views. CUP is not an agent loop. Two 2026 results change what that loop should look like:

1. **Recursive Language Models (RLMs)** put the prompt *outside* the transformer and let the model program over it in a REPL, including recursive self-calls ([Zhang, Kraska, Khattab, arXiv:2512.24601](https://arxiv.org/abs/2512.24601); [Prime Intellect, *Recursive Language Models: the paradigm of 2026*](https://www.primeintellect.ai/blog/rlm)).
2. **Continual Harness** treats the harness itself as editable state: system prompt, sub-agents, skills, and memory receive CRUD updates mid-episode from a Refiner reading recent failure signatures ([Karten et al., arXiv:2605.09998](https://arxiv.org/abs/2605.09998)).

Prime Agent later composes both: RLM for L2 programmatic context, Continual Harness for L3 disk-backed prompt/skill/memory evolution ([Karten, Zhang, et al., arXiv:2608.23552](https://arxiv.org/abs/2608.23552)).

## What a harness is

| Object | Question it answers |
| --- | --- |
| Model | How is the next token or tool call sampled? |
| Environment | What world does the agent act in (files, APIs, browsers, games, databases)? |
| Platform | Through what channel is the agent delivered (IDE, CLI, hosted API)? |
| Harness | How do model outputs become tool calls, observations, memory, approvals, interruptions, resumptions, and recoverable actions? |

Liu (*Engineering and Governing the Agent Harness*, UNU Macau, 2026) argues that evaluation and safety attach to the **model plus harness pair**. Guo et al. (arXiv:2606.20683) write the same as \(\mathcal{A}_{\mathrm{LLM}} = \langle \mathcal{M}, \mathcal{H} \rangle\).

A harness is the runtime around one or more LLMs that mediates output and external action, maintains state across invocations, constrains action selection, and externalizes memory, observation, and recovery. That is different from an **agent framework** (LangGraph, AutoGen, CrewAI): a framework is a kit of parts you assemble. A harness is a pre-wired loop you point at a task.

CUP already occupies T and part of L: it registers agents as resources, assigns principal identities, and governs discover/read/execute/delegate. It does not plan, compact, recurse over context, or rewrite its own skill library. This repo is that missing runtime.

## Why the bottleneck moved to the harness

Static QA benchmarks are saturating. Agentic benchmarks are not: SWE-bench, WebArena, OSWorld, TheAgentCompany, Terminal-Bench, AgencyBench, τ-bench. The gap is forgotten state, premature completion, context rot, unsafe tools, opaque compaction, and missing recovery.

Evidence that **holding the model fixed and changing \(\mathcal{H}\)** moves outcomes:

- SWE-agent ACI (Yang et al., NeurIPS 2024): observation format and edit guardrails beat a raw shell.
- Bölük (2026) and related practitioner reports: edit-tool format changes swing coding-bench scores across many models.
- Trivedy / LangChain (2026): GPT-5.2-Codex Terminal-Bench 2.0 from 52.8% to 66.5% by prompt, middleware context, and self-verification only.
- HAL (arXiv:2510.11977): 21,730 rollouts across 9 models and 9 benchmarks; scaffold choice is first-class, not a footnote.
- *Stop Comparing LLM Agents Without Disclosing the Harness* (arXiv:2605.23950): Binding Constraint Thesis. For long-horizon tasks among comparable frontier models, harness variance can exceed model variance and reverse rankings. Leaderboards without harness disclosure are incomplete.
- AgencyBench (arXiv:2601.11044): ~90 tool calls and ~1M tokens per scenario; proprietary models peak in *native* harnesses, open models peak in different scaffolds.

## Four engineering paradigms (Guo et al., 2026)

| Phase | Unit of optimization | Failure it cannot fix |
| --- | --- | --- |
| Prompt engineering | The instruction | Missing knowledge, growing state |
| Workflows and context engineering | What enters the window | Drift, verification, recovery |
| Harness engineering | Closed-loop runtime (sandbox, checkpoint, verify, sub-agents) | Behavior still hand-specified |
| Agent-native training and co-evolution | Model, harness, and traces together | Still early; capability floors apply |

All four coexist. This repo starts in phase 3 with CUP as the permission kernel, and should leave hooks for phase-4 ideas (RLM training, Continual Harness refinement) without building a Pokémon-scale refiner on day one.

Two 2026 taxonomies are useful together:

- Meng et al.: \(H = (E, T, C, S, L, V)\) (loop, tools, context, state, lifecycle, eval).
- Li et al. *Agent Harness Engineering*: **ETCLOVG** (execution environment, tool interface, context, lifecycle, **observability**, verification, **governance**). Observability and governance are first-class, not buried in lifecycle.

CUP is a strong G (governance) and T (tool interface). This harness must still own E, C, L, O, V, and a programmable C that can become RLM-shaped.

## Late research that should shape v1

### 1. Recursive Language Models: context as environment

**Paper:** Zhang, Kraska, Khattab, *Recursive Language Models*, [arXiv:2512.24601](https://arxiv.org/abs/2512.24601) (code: [alexzhang13/rlm](https://github.com/alexzhang13/rlm)).  
**Production write-up:** Prime Intellect, [*Recursive Language Models: the paradigm of 2026*](https://www.primeintellect.ai/blog/rlm).

**Claim.** Do not feed a huge prompt into the transformer. Load it as a variable in a persistent Python REPL. The root model sees only constant-size metadata (length, short prefix, how to access slices). It writes code to peek, partition, grep, transform, and recursively call `llm_query` / `llm_batch` on snippets. Only metadata of stdout returns to the root history. The final answer is a REPL variable (`Final`, or Prime Intellect's `answer["content"]` plus `answer["ready"]`), not a one-shot autoregressive dump.

**Why this is a harness paper, not a model paper.** RLM is an inference-time scaffold around an unchanged \(\mathcal{M}\). It attacks context rot (Hong, Troynikov, Huber, Chroma, 2025) by never stuffing the haystack into L1. Compaction *forgets*. RLM *delegates*. Zhang et al. report median gains on GPT-5 vs compaction (~26%), vs CodeAct with sub-calls (~130%), vs Claude Code (~13%) on four long-context tasks, with comparable cost, and handling of 10M+ token inputs that do not fit the native window. They also post-train RLM-Qwen3-8B (+28% median vs base Qwen3-8B).

**Prime Intellect flavor (important for a CUP-based harness):**

- Extra input data is *only* available programmatically. REPL stdout shown to the root is capped (default 8192 chars), so the model is forced to filter in code or in sub-LLMs.
- Tools that emit huge observations (search, `open` URL) are given to **sub-LLMs only**. The root never eats a 1.5M-token page.
- `llm_batch` parallelizes sub-calls.
- Sandboxed execution; pip packages; answer diffusion via a mutable `answer` dict.
- Untrained models often *misuse* the scaffold: math-python got *worse* under RLM for GPT-5-mini because the extra complexity is unused; DeepDive only won after environment tips told it to decompose into parallel sub-research. **Scaffolding without training can make the model dumber.** Tips and later RL on the RLM are part of the harness, not optional docs.

**Contrast with adjacent 2025-2026 context methods:**

| Method | What it does | Information loss? |
| --- | --- | --- |
| Compaction / summarization | Compress history into a new window | Yes, irreversible |
| Observation masking (Complexity Trap, arXiv:2508.21433) | Keep last M observations; stub the rest | Yes, but cheap; matched LLM-summary on SWE-bench Verified |
| Context-Folding / AgentFold | Branch, then fold to a summary | Yes, but structured |
| Cat / SWE-Compressor (arXiv:2512.22087) | Context maintenance as a *callable tool* | Learned when to fold |
| Anthropic code execution with MCP (2025-11-04) | Tools as files; filter in the sandbox | Intermediate results stay out of the model |
| **RLM** | Prompt is a REPL variable; recursive self-calls | Root never holds the haystack |

RLM is the Bitter Lesson version: do not hand-author folding policy; let the model write programs over context. Anthropic's code-execution-with-MCP post is the same *shape* for tools (filesystem of APIs, filter before the model). A CUP harness should treat **authorized views and large `read()` results the same way**: pointers and code, not blobs in the next prompt.

**Harness implications for this repo:**

- v1 can stay ReAct, but the **context manager must not assume the prompt is the working set**. Large CUP reads, MCP payloads, and memory dumps go to files or a REPL variable.
- Sub-calls need **attenuated CUP subjects**, not the parent's full grant (RLM sub-LLMs with tools is a privilege-escalation footgun if identity is shared).
- Truncate REPL/tool stdout at the harness boundary. CUP redaction plus a char cap.
- Do not ship a full RLM on day one unless the first product is long-context aggregation. Do ship the **interface**: `context as object`, `execute_code`, `spawn_subagent(subject, grant)`.

### 2. Continual Harness: the harness as editable state

**Paper:** Karten, Zhang, Upaa, Feng, Li, Shi, Jin, Vodrahalli, *Continual Harness: Online Adaptation for Self-Improving Foundation Agents*, [arXiv:2605.09998](https://arxiv.org/abs/2605.09998).  
**Code:** [sethkarten/continual-harness](https://github.com/sethkarten/continual-harness).

**Claim.** Coding harnesses (Claude Code, OpenHands, OpenClaw) are mature. Embodied agents had no equivalent. Gemini Plays Pokémon showed that *human* mid-run harness edits (prompt, sub-agents, skills, memory) can finish multiple Pokémon RPGs. Continual Harness automates that Refiner.

Harness state:

\[
\mathcal{H} = (p, \mathcal{G}, \mathcal{K}, \mathcal{M})
\]

system prompt, sub-agents, skills, memory. Every \(F\) steps after warmup, a Refiner reads \(\tau_{t-F:t}\) for failure signatures (loops, tool failures, stalled objectives, missed exploration) and applies CRUD:

- rewrite \(p\)
- create/edit/delete sub-agent entries
- codify skills from successful sequences; repair code that threw
- add/update/demote memories

Updates are **reset-free**: no episode restart (unlike GEPA-style prompt opt). Refinement quality compounds with episode length. Late-game failures are reachable. Gains scale with model capability: Pareto-dominant on Gemini 3 Pro, high-variance on Flash, **below the floor on Flash-Lite** (Continual Harness *hurt* the weakest model). Co-learning: open-source student + live-refining harness + PRM + teacher relabel, still reset-free.

**Why this matters for a CUP harness.** CUP already versions policies, capabilities, and receipts. Continual Harness says the *behavioral* surface (\(p, \mathcal{G}, \mathcal{K}, \mathcal{M}\)) should also be versioned, receipted, and editable. That is dangerous if skills can jailbreak the next turn (LITMUS: skill injection and entity wrapping beat naive prompt attacks). So:

- Treat skill/prompt/memory writes as CUP `execute` with risk, confirmation, and receipts.
- Refiner identity is a distinct `Subject` (`agent:refiner`), not the worker.
- CRUD on \(\mathcal{H}\) is auditable. You can roll back a poisoned skill.
- Do not enable a live Refiner until the worker loop and CUP gates work. The *data model* for \(p, \mathcal{G}, \mathcal{K}, \mathcal{M}\) should exist in v1 as files plus resources.

### 3. Prime Agent: RLM plus Continual Harness

[arXiv:2608.23552](https://arxiv.org/abs/2608.23552) / [PrimeIntellect-ai/prime-agent](https://github.com/PrimeIntellect-ai/prime-agent). Memory hierarchy:

| Layer | Contents |
| --- | --- |
| L0 | Weights |
| L1 | Active context window |
| L2 | Persistent REPL + recursive sub-agents (RLM) |
| L3 | Disk histories, memories, skills (Continual Harness) |

Expressivity over workflow encoding: the model constructs programs, sub-agents, and feedback loops at inference time. Direct agent-to-agent messaging plus a human Agents View. Reported ARC-AGI-3 RHAE Best@1 30% to 95.5% under this membrane (treat as their eval, not ours).

For CUP: L2 is execution sandbox + recursive invoke capability. L3 is memory/skill resources. Governance stays in CUP so L2/L3 cannot silently widen authority.

### 4. Production harnesses, 2025-2026

**Anthropic**

- *Effective context engineering* (2025-09-29): attention budget; just-in-time retrieval; progressive disclosure.
- *Effective harnesses for long-running agents* (2025-11-26): initializer vs coding agent; `feature_list.json` with `"passes": false`; `claude-progress.txt`; git as ground truth; compaction is not enough across sessions; JSON task lists mutate more safely than Markdown; end-to-end tests (browser), not self-report.
- *Harness design for long-running application development* (2026-03): generator / evaluator / sprint contracts; **drop context resets** when Opus 4.5 "context anxiety" disappeared. Build for deletion.
- *Code execution with MCP* (2025-11-04): tools as a filesystem; 98.7% token cut in the Drive-to-Salesforce example; PII tokenization in the client; skills as saved functions plus `SKILL.md`.
- *Scaling Managed Agents* (2026-04-08): virtualize **session** (append-only event log, `getEvents()` slices), **harness** (stateless loop), **sandbox**. Decouple brain from hands. Credentials never in the sandbox. Session is not the context window. Irreversible compaction is a last resort if events are stored.

**OpenAI**

- *Harness engineering: leveraging Codex in an agent-first world* ([openai.com/index/harness-engineering](https://openai.com/index/harness-engineering/)): ~1M-line internal app, agent-written. Fat `AGENTS.md` failed. Short map (~100 lines) plus `docs/` as system of record. Mechanical linters with agent-readable remediations. Plans as first-class repo artifacts.

**LangChain Deep Agents:** batteries-included open harness (filesystem, compaction, skills, HITL, MCP/A2A). Harbor + Terminal-Bench as the eval path.

**mini-SWE-agent:** bash-only, `subprocess.run` per action (no stateful shell), >74% SWE-bench Verified in their reporting. Simplicity is a competitive harness.

**Vercel tool-cut:** fewer, general tools beat a zoo of specialists.

### 5. Memory, skills, security, eval (selected 2025-2026)

**Memory:** MemoryOS (EMNLP 2025), MemOS, A-Mem (NeurIPS 2025), Mem0 (ECAI 2025), Zep TKG, HiAgent, MEM1, Agentic Memory (arXiv:2601.01885), Prism (arXiv:2604.19795). Consensus: hierarchical store plus explicit promotion; not "dump the transcript."

**Skills:** Anthropic Agent Skills; SkillsBench (arXiv:2602.12670); SoK: Agentic Skills (arXiv:2602.20867); *Towards Secure Agent Skills* (arXiv:2604.02837). Progressive disclosure is the load pattern. Skills are a supply-chain and injection surface.

**Security:** LITMUS (arXiv:2605.10779) behavioral jailbreaks in real OS; skill injection and entity wrapping beat direct prompts. AgentDojo-class observation-stream attacks. ceLLMate browser sandboxing. AEGIS-style control planes (capability manifest, taint, replay). CUP obligations and receipts are the local answer if we actually route every effect through them.

**Eval:** HAL, AgencyBench, Terminal-Bench 2.x, VeRO (agents optimizing agents), NLAH (arXiv:2603.25723, harness logic as natural-language artifact), Meta-Harness (search over harness config).

**Natural-Language Agent Harnesses** and **Continual Harness** agree on one operational point: harness logic should be an inspectable artifact (charter, skills, CRUD-able state), not only Python buried in a loop.

## Mapping onto Capability UI

CUP 0.2.0: resources, capabilities, deny-by-default policy, field redaction, authorized views, prepare/execute, confirmation hashes, delegation, receipts, MCP, CLI. Not: ReAct loop, provider calls, REPL, compaction, skill CRUD, sandbox, host auth.

| Slot | CUP | This harness | Late-research default |
| --- | --- | --- | --- |
| Execution environment | No | Host sandbox | Managed Agents: cattle, not pets; RLM REPL isolated |
| Tool interface | Capabilities, discover/inspect, MCP | Project a **small** authorized set | Code-mode MCP; tools to sub-agents for fat outputs |
| Context | `project()` is a catalog, not a transcript | Assemble prompt, skills, pointers | RLM: prompt as object; cap stdout; JIT load |
| State | Receipts; host SQL in docs | Session event log + progress/JSON | Managed Agents `getEvents()`; initializer artifacts |
| Lifecycle | Policy, confirmation, grants | Identity, budgets, stop hooks | Refiner as separate subject (later) |
| Observability | Receipt query | Traces, token/cost, cache hits | HAL-style scaffold disclosure |
| Verification | Not eval | Tests, contracts, independent grader | Anthropic generator/evaluator; no self-grade |
| Governance | Strong | Do not fork policy into prompts | Continual Harness CRUD goes through CUP |

Keel (`examples/agent-studio`) renders an authorized view. Copy the discipline (UI is not the lock). Do not copy the prompt-to-UI composer as the agent loop.

## Recommended stance for agent-harness

1. **CUP is T and G.** Every tool is a capability. Every fat read is a resource. The worker is `type: 'agent'`. User identity is not impersonated on downstream calls.
2. **Context is an object.** v1: files plus char-capped observations plus `project()`. v1.5: RLM-style REPL for large payloads. Never treat the chat transcript as the source of truth.
3. **Harness state is data.** Persist \(p, \mathcal{G}, \mathcal{K}, \mathcal{M}\) (prompt, sub-agent specs, skills, memory) as versioned artifacts with receipts. Live Refiner is a later milestone; the schema is not.
4. **Boring loop first.** ReAct, turn budget, malformed retry, stop-hook that re-reads disk. Independent checks. JSON feature/task list over Markdown checklists.
5. **Sub-agents are attenuated grants**, not copied tool lists.
6. **Build for deletion.** If a stronger model makes compaction or a specialized tool unnecessary, remove it. If RLM training makes env-tips unnecessary, delete the tips.
7. **Disclose the harness in evals.** Binding Constraint Thesis: do not claim model wins without naming loop, tools, context policy, and verification.

## Settled answers (v1)

These close the research questions using the full corpus, not two papers in isolation:

- **Product:** coding agent CLI (`harness`), same job as Claude Code, Codex, Pi, and Prime Agent. CUP is the tool and policy kernel; this repo owns the loop.
- **CUP install:** `file:../Capability-UI` in this workspace (same as CUP examples). Later consumers use GitHub Packages `@capability-ui/core@0.2.0`. No submodule, no vendored CUP source.
- **Continual Harness:** persist \(\mathcal{H}\) on disk and let the worker edit it through CUP. No automatic Refiner in v1. Continual Harness helps strong models and hurts weak ones; LITMUS makes unreceipted skill writes an injection surface. Prime Agent's Refiner is v2 (`--refine`, subject `agent:refiner`).
- **Context vs RLM:** v1 uses files, observation caps, and observation masking (Complexity Trap, context rot, OpenAI AGENTS.md map, Anthropic progressive disclosure). `src/repl.ts` is a reserved RLM interface, not a live REPL. Prompt-only RLM; no RLM training in this repo.
- **Provider:** OpenAI-compatible `/chat/completions` (`OPENAI_API_KEY`, optional `OPENAI_BASE_URL` / `OPENAI_MODEL`).

## Sources

### Named user sources

- Prime Intellect, *Recursive Language Models: the paradigm of 2026*. https://www.primeintellect.ai/blog/rlm
- Karten et al., *Continual Harness: Online Adaptation for Self-Improving Foundation Agents*. https://arxiv.org/abs/2605.09998

### Recursive / self-improving harnesses

- Zhang, Kraska, Khattab, *Recursive Language Models*. https://arxiv.org/abs/2512.24601
- Karten, Zhang, et al., *Prime Agent: A Self-Improving RLM Harness*. https://arxiv.org/abs/2608.23552

### Surveys and position papers (2026)

- Meng et al., *Agent Harness for LLM Agents: A Survey*. https://doi.org/10.20944/preprints202604.0428.v3
- Li et al., *Agent Harness Engineering: A Survey* (ETCLOVG). https://picrew.github.io/LLM-Harness/main.pdf
- Guo et al., *From Question Answering to Task Completion*. https://arxiv.org/abs/2606.20683
- *Stop Comparing LLM Agents Without Disclosing the Harness*. https://arxiv.org/abs/2605.23950
- Liu, UNU Macau harness governance report. https://unu.edu/sites/default/files/2026-07/Engineering_and_Governing_the_Agent_Harness.pdf
- RUCAIBox, *Agent Systems with Harness Engineering* reading list. https://github.com/RUCAIBox/awesome-agent-harness

### Context, memory, tools

- Hong, Troynikov, Huber, *Context rot*, Chroma, 2025. https://research.trychroma.com/context-rot
- Lindenbauer et al., *The Complexity Trap*. https://arxiv.org/abs/2508.21433
- Sun et al., *Context-Folding*. https://arxiv.org/abs/2510.11967
- AgentFold. https://arxiv.org/abs/2510.24699
- Cat / SWE-Compressor. https://arxiv.org/abs/2512.22087
- MemoryOS. https://arxiv.org/abs/2506.06326
- A-Mem. https://arxiv.org/abs/2502.12110
- Mem0. https://arxiv.org/abs/2504.19413
- Anthropic, effective context engineering. https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Anthropic, code execution with MCP. https://www.anthropic.com/engineering/code-execution-with-mcp
- Anthropic, long-running agents. https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Anthropic, long-running apps. https://www.anthropic.com/engineering/harness-design-long-running-apps
- Anthropic, Managed Agents. https://www.anthropic.com/engineering/managed-agents
- OpenAI, harness engineering. https://openai.com/index/harness-engineering/

### Eval and security

- HAL. https://arxiv.org/abs/2510.11977
- AgencyBench. https://arxiv.org/abs/2601.11044
- LITMUS. https://arxiv.org/abs/2605.10779
- SkillsBench. https://arxiv.org/abs/2602.12670

### Lineage (still load-bearing)

- Yao et al., ReAct. https://arxiv.org/abs/2210.03629
- Packer et al., MemGPT. https://arxiv.org/abs/2310.08560
- Yang et al., SWE-agent. https://arxiv.org/abs/2405.15793

### In-tree CUP

- Capability-UI `README.md`, `docs/docs/foundations/mental-model.md`, `docs/docs/foundations/agent-neutrality.md`, `docs/docs/runtimes/agent-resources.md`, `src/runtime.ts`

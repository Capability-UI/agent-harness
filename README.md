# agent-harness

Coding agent CLI in the same family as Claude Code, Codex, Pi, and Prime Agent. Capability UI Protocol (CUP) is the kernel for tool definitions, authorization, and receipts. This repo owns the loop, context, session, and workspace jail.

```bash
cd ../Capability-UI && npm install && npm run build
cd ../agent-harness && npm install && npm run build
npx harness init --workspace .
npx harness tools --workspace .
OPENAI_API_KEY=... npx harness run "fix the failing test" --workspace .
```

The `harness` binary is `dist/src/cli.js`. Run `npm run build` after a clean install.

Requires a sibling checkout of `Capability-UI` (`file:../Capability-UI`). See [docs/developer/overview.md](docs/developer/overview.md).

Research: [docs/llm-agent-harness-research.md](docs/llm-agent-harness-research.md)  
Plan: [docs/plans/2026-09-07-001-plan-capability-ui-harness.md](docs/plans/2026-09-07-001-plan-capability-ui-harness.md)

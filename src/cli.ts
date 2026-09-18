#!/usr/bin/env node
import './sqlite-warning.js';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DEFAULT_MAX_TURNS } from './constants.js';
import { openCupStore } from './cup-store.js';
import { createHarnessCup } from './host.js';
import { ensureHarnessLayout, loadHarnessState } from './harness-state.js';
import { runAgentLoop, unauthorizedToolSpecs } from './loop.js';
import { createModel, stripReasoning } from './provider.js';
import { runNamedSubagent } from './run-subagent.js';
import { SessionLog } from './session.js';
import { createSubagent, listSubagents, loadSubagent } from './subagent.js';
import { codingCapabilities } from './tools.js';
import { Workspace } from './workspace.js';

interface CliOptions {
  command: string;
  subcommand: string;
  name: string;
  prompt: string;
  workspace: string;
  maxTurns: number;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  promptFile?: string;
  allow?: string;
  help: boolean;
  unknownCommand?: string;
}

export const HARNESS_COMMANDS = ['run', 'init', 'tools', 'subagent'] as const;

export function parseHarnessArgv(argv: string[]): CliOptions {
  const options: CliOptions = {
    command: 'run',
    subcommand: '',
    name: '',
    prompt: '',
    workspace: process.cwd(),
    maxTurns: DEFAULT_MAX_TURNS,
    help: false,
  };
  const rest: string[] = [];
  let commandParsed = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token) continue;
    if (token === '--help' || token === '-h') { options.help = true; continue; }
    if (token === '--workspace' || token === '-C') {
      options.workspace = argv[++i] ?? options.workspace;
      continue;
    }
    if (token === '--max-turns') {
      options.maxTurns = Number(argv[++i] ?? DEFAULT_MAX_TURNS);
      continue;
    }
    if (token === '--api-key') {
      options.apiKey = argv[++i];
      continue;
    }
    if (token === '--base-url') {
      options.baseUrl = argv[++i];
      continue;
    }
    if (token === '--model') {
      options.model = argv[++i];
      continue;
    }
    if (token === '--prompt') {
      options.promptFile = argv[++i];
      continue;
    }
    if (token === '--allow') {
      options.allow = argv[++i];
      continue;
    }
    if (
      !token.startsWith('-') &&
      !commandParsed &&
      rest.length === 0
    ) {
      if ((HARNESS_COMMANDS as readonly string[]).includes(token)) {
        options.command = token;
        commandParsed = true;
        continue;
      }
      options.command = 'unknown';
      options.unknownCommand = token;
      commandParsed = true;
      continue;
    }
    rest.push(token);
  }
  if (options.command === 'subagent') {
    options.subcommand = rest.shift() ?? '';
    if (options.subcommand === 'create' || options.subcommand === 'run') {
      options.name = rest.shift() ?? '';
    }
  }
  options.prompt = rest.join(' ').trim();
  return options;
}

const USAGE = `Usage: harness <run|init|tools|subagent> [prompt] [options]

Coding agent CLI. Tools and policy go through Capability UI. The loop, context, and session live here.

Commands:
  run <prompt>    run the agent (requires an API key)
  init            create .harness layout in the workspace
  tools           list CUP-authorized tools for agent:coder
  subagent create <name> --prompt <file> [--allow a,b,c]
                  save a reusable, CUP-scoped subagent (own subject + memory)
  subagent list   list saved subagents and their allowed capabilities
  subagent run <name> <goal>
                  run a saved subagent as its own subject (requires an API key)

Unknown first tokens are errors (they are not treated as a run prompt).
Autoresearch and benchmark batteries live under research/ (node research/eval/run.mjs), not as harness verbs.

Options (run):
  --workspace <dir>   workspace root (default: cwd)
  --max-turns <n>       turn budget (default: 40)
  --api-key <key>       API key (overrides OPENAI_API_KEY)
  --base-url <url>      OpenAI-compatible API root (overrides OPENAI_BASE_URL)
  --model <id>          model id (overrides OPENAI_MODEL)

Options (subagent):
  --prompt <file>       system prompt file for 'subagent create'
  --allow a,b,c         comma-separated capability ids the subagent may use
  --workspace <dir>     workspace root (default: cwd)

Env (OpenAI-compatible providers, including OpenRouter):
  OPENAI_API_KEY        default https://api.openai.com/v1 when OPENAI_BASE_URL is unset
  OPENAI_BASE_URL       e.g. https://openrouter.ai/api/v1
  OPENAI_MODEL          e.g. anthropic/claude-sonnet-4 on OpenRouter

Example (OpenRouter):
  harness run "fix tests" \\
    --base-url https://openrouter.ai/api/v1 \\
    --api-key "$OPENROUTER_API_KEY" \\
    --model anthropic/claude-sonnet-4
`;

export async function runCli(argv: string[], write: (text: string) => void = text => { process.stdout.write(text); }): Promise<number> {
  const options = parseHarnessArgv(argv);
  if (options.help) {
    write(USAGE);
    return 0;
  }
  if (options.command === 'unknown') {
    write(`Unknown command: ${options.unknownCommand}\n`);
    write('Research/eval scripts live under research/, not as harness verbs.\n');
    write(USAGE);
    return 1;
  }
  const workspace = new Workspace(options.workspace);
  await workspace.ensureRoot();
  if (options.command === 'init') {
    await ensureHarnessLayout(workspace);
    const store = openCupStore(workspace);
    store.close();
    write(`Initialized harness files under ${workspace.join('.harness')}\n`);
    return 0;
  }
  if (options.command === 'tools') {
    const { cup, coder } = createHarnessCup(workspace);
    const view = await cup.project({
      subject: coder,
      goal: options.prompt || 'list tools',
      context: { purpose: 'coding', channel: 'cli', workspace: workspace.root },
    });
    for (const capability of view.capabilities) {
      write(`${capability.id}\t${capability.risk}\n`);
    }
    return 0;
  }
  if (options.command === 'subagent') {
    return runSubagentCommand(options, workspace, write);
  }
  if (!options.prompt) {
    write('A prompt is required for run.\n');
    write(USAGE);
    return 1;
  }
  const model = createModel({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    model: options.model,
  });
  if (!model) {
    write('An API key is required for run (OPENAI_API_KEY or --api-key).\n');
    return 1;
  }
  await ensureHarnessLayout(workspace);
  const store = openCupStore(workspace);
  try {
    const { cup, coder, runtime } = createHarnessCup(workspace, store.receiptSink, store);
    runtime.model = model;
    const state = await loadHarnessState(workspace, store, coder.id);
    const session = new SessionLog(workspace, randomUUID(), store, coder.id);
    const result = await runAgentLoop({
      cup,
      coder,
      workspace,
      state,
      model,
      goal: options.prompt,
      maxTurns: options.maxTurns,
      session,
    });
    write(`${stripReasoning(result.text)}\n\n[stop=${result.stopReason} turns=${result.turns} session=${result.sessionId}]\n`);
    return 0;
  } finally {
    store.close();
  }
}

async function runSubagentCommand(
  options: CliOptions,
  workspace: Workspace,
  write: (text: string) => void,
): Promise<number> {
  await ensureHarnessLayout(workspace);
  if (options.subcommand === 'create') {
    if (!options.name) {
      write('A subagent name is required: harness subagent create <name> --prompt <file>\n');
      return 1;
    }
    if (!options.promptFile) {
      write('A prompt file is required: harness subagent create <name> --prompt <file>\n');
      return 1;
    }
    const promptText = await readFile(options.promptFile, 'utf8');
    const allow = options.allow
      ? options.allow.split(',').map(item => item.trim()).filter(Boolean)
      : undefined;
    const spec = await createSubagent(workspace, {
      name: options.name,
      promptText,
      allow,
    });
    write(`Created subagent ${spec.name} (${spec.id})\n`);
    write(`  allow: ${spec.allow.join(', ')}\n`);
    return 0;
  }
  if (options.subcommand === 'list') {
    const specs = await listSubagents(workspace);
    if (specs.length === 0) {
      write('No subagents saved.\n');
      return 0;
    }
    for (const spec of specs) {
      write(`${spec.name}\t${spec.allow.join(', ')}\n`);
    }
    return 0;
  }
  if (options.subcommand === 'run') {
    if (!options.name) {
      write('A subagent name is required: harness subagent run <name> <goal>\n');
      return 1;
    }
    if (!options.prompt) {
      write('A goal is required: harness subagent run <name> <goal>\n');
      return 1;
    }
    const { spec } = await loadSubagent(workspace, options.name);
    const model = createModel({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model ?? spec.model,
    });
    if (!model) {
      write('An API key is required for run (OPENAI_API_KEY or --api-key).\n');
      return 1;
    }
    const store = openCupStore(workspace);
    try {
      const { cup, runtime } = createHarnessCup(workspace, store.receiptSink, store);
      runtime.model = model;
      const result = await runNamedSubagent({
        workspace,
        name: options.name,
        goal: options.prompt,
        cup,
        model,
        store,
        maxTurns: options.maxTurns,
        extraTools: unauthorizedToolSpecs(codingCapabilities(workspace, store), spec.allow),
      });
      write(`${stripReasoning(result.text)}\n\n[stop=${result.stopReason} turns=${result.turns} session=${result.sessionId}]\n`);
      return 0;
    } finally {
      store.close();
    }
  }
  write(`Unknown subagent subcommand: ${options.subcommand || '(none)'}\n`);
  write(USAGE);
  return 1;
}


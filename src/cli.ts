#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { DEFAULT_MAX_TURNS } from './constants.js';
import { createHarnessCup } from './host.js';
import { ensureHarnessLayout, loadHarnessState } from './harness-state.js';
import { runAgentLoop } from './loop.js';
import { createModel } from './provider.js';
import { SessionLog } from './session.js';
import { Workspace } from './workspace.js';

interface CliOptions {
  command: string;
  prompt: string;
  workspace: string;
  maxTurns: number;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  help: boolean;
}

export function parseHarnessArgv(argv: string[]): CliOptions {
  const options: CliOptions = {
    command: 'run',
    prompt: '',
    workspace: process.cwd(),
    maxTurns: DEFAULT_MAX_TURNS,
    help: false,
  };
  const rest: string[] = [];
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
    if (!token.startsWith('-') && rest.length === 0 && (token === 'run' || token === 'init' || token === 'tools')) {
      options.command = token;
      continue;
    }
    rest.push(token);
  }
  options.prompt = rest.join(' ').trim();
  return options;
}

const USAGE = `Usage: harness <run|init|tools> [prompt] [options]

Coding agent CLI. Tools and policy go through Capability UI. The loop, context, and session live here.

Commands:
  run <prompt>    run the agent (requires an API key)
  init            create .harness layout in the workspace
  tools           list CUP-authorized tools for agent:coder

Options (run):
  --workspace <dir>   workspace root (default: cwd)
  --max-turns <n>       turn budget (default: 40)
  --api-key <key>       API key (overrides OPENAI_API_KEY)
  --base-url <url>      OpenAI-compatible API root (overrides OPENAI_BASE_URL)
  --model <id>          model id (overrides OPENAI_MODEL)

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
  const workspace = new Workspace(options.workspace);
  await workspace.ensureRoot();
  if (options.command === 'init') {
    await ensureHarnessLayout(workspace);
    write(`Initialized harness files under ${workspace.join('.harness')}\n`);
    return 0;
  }
  const { cup, coder } = createHarnessCup(workspace);
  if (options.command === 'tools') {
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
  const state = await loadHarnessState(workspace);
  const session = new SessionLog(workspace, randomUUID());
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
  write(`${result.text}\n\n[stop=${result.stopReason} turns=${result.turns} session=${result.sessionId}]\n`);
  return 0;
}

const isMain = process.argv[1] && (process.argv[1].endsWith('cli.ts') || process.argv[1].endsWith('cli.js'));
if (isMain) {
  runCli(process.argv.slice(2)).then(code => process.exit(code)).catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

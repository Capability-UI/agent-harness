#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { DEFAULT_MAX_TURNS } from './constants.js';
import { createHarnessCup } from './host.js';
import { ensureHarnessLayout, loadHarnessState } from './harness-state.js';
import { runAgentLoop } from './loop.js';
import { modelFromEnv } from './provider.js';
import { SessionLog } from './session.js';
import { Workspace } from './workspace.js';

interface CliOptions {
  command: string;
  prompt: string;
  workspace: string;
  maxTurns: number;
  help: boolean;
}

function parseArgv(argv: string[]): CliOptions {
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
    if (!token.startsWith('-') && rest.length === 0 && (token === 'run' || token === 'init' || token === 'tools')) {
      options.command = token;
      continue;
    }
    rest.push(token);
  }
  options.prompt = rest.join(' ').trim();
  return options;
}

const USAGE = `Usage: harness <run|init|tools> [prompt] [--workspace <dir>] [--max-turns <n>]

Coding agent CLI. Tools and policy go through Capability UI. The loop, context, and session live here.

Commands:
  run <prompt>    run the agent (requires OPENAI_API_KEY)
  init            create .harness layout in the workspace
  tools           list CUP-authorized tools for agent:coder

Env:
  OPENAI_API_KEY OPENAI_BASE_URL OPENAI_MODEL
`;

export async function runCli(argv: string[], write: (text: string) => void = text => { process.stdout.write(text); }): Promise<number> {
  const options = parseArgv(argv);
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
  const model = modelFromEnv();
  if (!model) {
    write('OPENAI_API_KEY is required for run.\n');
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

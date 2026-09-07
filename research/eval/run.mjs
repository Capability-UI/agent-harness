// Fixed evaluator: runs the harness `run` loop over the battery and prints a
// single JSON metric. Integrity-protected: the autoresearch loop must not edit
// this file or battery.mjs. Usage: node research/eval/run.mjs [--json]
import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ALLOWED_BATTERIES = { battery: './battery.mjs', hard: './hard.mjs', humaneval: './humaneval.mjs' };
const batteryKey = process.env.EVAL_BATTERY ?? 'battery';
const batterySpec = ALLOWED_BATTERIES[batteryKey];
if (!batterySpec) {
  process.stderr.write(`Unknown EVAL_BATTERY=${batteryKey}; allowed: ${Object.keys(ALLOWED_BATTERIES).join(', ')}\n`);
  process.exit(2);
}
const { TASKS } = await import(batterySpec);

const execFileP = promisify(execFile);
const HARNESS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(HARNESS_ROOT, 'dist', 'src', 'cli.js');
const TASK_TIMEOUT_MS = Number(process.env.EVAL_TASK_TIMEOUT_MS ?? 240000);

function parseTurns(stdout) {
  const match = stdout.match(/turns=(\d+)/);
  return match ? Number(match[1]) : NaN;
}

async function runTask(task) {
  const dir = await mkdtemp(join(tmpdir(), `eval-${task.name}-`));
  await task.setup(dir);
  let stdout = '';
  let crashed = false;
  try {
    const res = await execFileP(
      'node',
      [CLI, 'run', task.prompt, '--workspace', dir, '--max-turns', String(task.maxTurns)],
      { cwd: HARNESS_ROOT, timeout: TASK_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
    );
    stdout = res.stdout + res.stderr;
  } catch (error) {
    crashed = true;
    stdout = `${error.stdout ?? ''}${error.stderr ?? ''}${error.message ?? ''}`;
  }
  const pass = crashed ? false : await task.grade(dir, execFileP);
  const turns = parseTurns(stdout);
  return { name: task.name, pass, turns: Number.isNaN(turns) ? task.maxTurns : turns, crashed };
}

async function main() {
  const results = [];
  for (const task of TASKS) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await runTask(task));
  }
  const passes = results.filter(r => r.pass).length;
  const totalTurns = results.reduce((sum, r) => sum + r.turns, 0);
  const metric = { battery: batteryKey, model: process.env.OPENAI_MODEL ?? '(default)', passes, total: results.length, totalTurns, tasks: results };
  process.stdout.write(JSON.stringify(metric) + '\n');
}

main().catch(error => {
  process.stderr.write(String(error?.stack ?? error) + '\n');
  process.exit(1);
});

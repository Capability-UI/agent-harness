// Real-benchmark battery: the HumanEval dataset (openai/openai_humaneval),
// cached in data/humaneval.json. Each problem becomes an agentic task: the agent
// completes solution.py from the function signature + docstring, and it is graded
// by the problem's official hidden unit tests via python3. Integrity-protected:
// the autoresearch loop must not edit this file, the cache, or the grader.
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), 'data', 'humaneval.json');
const N = Number(process.env.HUMANEVAL_N ?? 20);
const MAX_TURNS = Number(process.env.HUMANEVAL_MAX_TURNS ?? 6);

const cache = JSON.parse(await readFile(DATA, 'utf8'));
const problems = cache.problems.slice(0, N);

function graderScript(entryPoint) {
  // Import solution.py as a module namespace (so any __main__ guard is inert),
  // then run the official test's check() against the entry-point function.
  return [
    'ns = {"__name__": "solution"}',
    'with open("solution.py") as fh:',
    '    exec(fh.read(), ns)',
    'with open("_hev_test.py") as fh:',
    '    exec(fh.read(), ns)',
    `ns["check"](ns[${JSON.stringify(entryPoint)}])`,
    'print("HEV_OK")',
    '',
  ].join('\n');
}

export const TASKS = problems.map(problem => {
  const shortId = problem.task_id.replace(/[^a-zA-Z0-9]/g, '_');
  return {
    name: `humaneval_${shortId}`,
    maxTurns: MAX_TURNS,
    prompt:
      'solution.py contains a Python function signature and docstring with the body missing. '
      + 'Implement the function body so it satisfies the docstring exactly. Keep the signature and '
      + 'any imports. Write ONLY valid Python to solution.py (no markdown fences, no explanations, '
      + 'no top-level test calls). You may run it with the bash tool to check for syntax errors.',
    async setup(dir) {
      await writeFile(join(dir, 'solution.py'), problem.prompt, 'utf8');
    },
    async grade(dir, execFileP) {
      await writeFile(join(dir, '_hev_test.py'), problem.test, 'utf8');
      await writeFile(join(dir, '_hev_check.py'), graderScript(problem.entry_point), 'utf8');
      try {
        await execFileP('bash', ['-lc', 'timeout 15 python3 _hev_check.py'], { cwd: dir });
        return true;
      } catch {
        return false;
      }
    },
  };
});

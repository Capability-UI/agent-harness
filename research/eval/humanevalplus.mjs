// Real-benchmark battery: HumanEval+ (evalplus/humanevalplus), cached in
// data/humanevalplus.json. Same agentic shape as the HumanEval battery, but with
// the far stricter EvalPlus test suites (graded via python3; requires numpy).
// Integrity-protected: the autoresearch loop must not edit this file or the cache.
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), 'data', 'humanevalplus.json');
const N = Number(process.env.HUMANEVALPLUS_N ?? process.env.HUMANEVAL_N ?? 12);
const MAX_TURNS = Number(process.env.HUMANEVALPLUS_MAX_TURNS ?? 6);

const cache = JSON.parse(await readFile(DATA, 'utf8'));
const problems = cache.rows.slice(0, N);

function graderScript(entryPoint) {
  return [
    'ns = {"__name__": "solution"}',
    'with open("solution.py") as fh:',
    '    exec(fh.read(), ns)',
    'with open("_hev_test.py") as fh:',
    '    exec(fh.read(), ns)',
    `ns["check"](ns[${JSON.stringify(entryPoint)}])`,
    'print("HEVPLUS_OK")',
    '',
  ].join('\n');
}

export const TASKS = problems.map(problem => {
  const shortId = String(problem.task_id).replace(/[^a-zA-Z0-9]/g, '_');
  return {
    name: `hevplus_${shortId}`,
    maxTurns: MAX_TURNS,
    prompt:
      'solution.py contains a Python function signature and docstring with the body missing. '
      + 'Implement the function body so it satisfies the docstring exactly. Keep the signature and '
      + 'any imports. Write ONLY valid Python to solution.py (no markdown fences, no explanations, '
      + 'no top-level calls). You may run it with the bash tool to check for syntax errors.',
    async setup(dir) {
      await writeFile(join(dir, 'solution.py'), problem.prompt, 'utf8');
    },
    async grade(dir, execFileP) {
      await writeFile(join(dir, '_hev_test.py'), problem.test, 'utf8');
      await writeFile(join(dir, '_hev_check.py'), graderScript(problem.entry_point), 'utf8');
      try {
        await execFileP('bash', ['-lc', 'timeout 30 python3 _hev_check.py'], { cwd: dir });
        return true;
      } catch {
        return false;
      }
    },
  };
});

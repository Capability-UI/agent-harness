// Real-benchmark battery: MultiPL-E HumanEval translated to TypeScript
// (nuprl/MultiPL-E, config humaneval-ts), cached in data/multipl-humaneval-ts.json.
// Benchmarks the harness in its own native language: the agent completes a TS
// function, graded by the problem's node:assert test suite via tsx.
// Integrity-protected: the autoresearch loop must not edit this file or the cache.
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = join(HERE, '..', '..');
const TSX = join(HARNESS_ROOT, 'node_modules', '.bin', 'tsx');
const DATA = join(HERE, 'data', 'multipl-humaneval-ts.json');
const N = Number(process.env.MULTIPL_TS_N ?? 15);
const MAX_TURNS = Number(process.env.MULTIPL_TS_MAX_TURNS ?? 6);

const cache = JSON.parse(await readFile(DATA, 'utf8'));
const problems = cache.rows.slice(0, N);

export const TASKS = problems.map(problem => {
  const shortId = String(problem.name).replace(/[^a-zA-Z0-9]/g, '_');
  return {
    name: `mpl_ts_${shortId}`,
    maxTurns: MAX_TURNS,
    prompt:
      'solution.ts contains a TypeScript function with a leading comment describing it and an '
      + 'empty/undefined body. Implement the function body so it matches the description. Keep the '
      + 'exact signature. Write ONLY valid TypeScript to solution.ts — no import or export statements, '
      + 'no markdown fences, no explanations, and no test code.',
    async setup(dir) {
      await writeFile(join(dir, 'solution.ts'), problem.prompt, 'utf8');
    },
    async grade(dir, execFileP) {
      let solution;
      try {
        solution = await readFile(join(dir, 'solution.ts'), 'utf8');
      } catch {
        return false;
      }
      const combined = `${solution}\n\n${problem.tests}\n`;
      await writeFile(join(dir, '_mpl_check.ts'), combined, 'utf8');
      try {
        await execFileP('bash', ['-lc', `timeout 30 "${TSX}" _mpl_check.ts`], { cwd: dir });
        return true;
      } catch {
        return false;
      }
    },
  };
});

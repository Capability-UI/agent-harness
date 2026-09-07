// Karpathy-style autoresearch ratchet for the agent-harness.
// Loop: pick one source file -> ask the researcher model for a full rewrite ->
// build -> run unit tests -> run the fixed evaluator -> keep the change only if
// it builds, keeps tests green, and strictly improves (passes, -totalTurns);
// otherwise `git checkout` reverts it. Every accepted change is a git commit.
//
// Env: OPENAI_BASE_URL, OPENAI_API_KEY, OPENAI_MODEL (researcher + evaluator model).
// Config: RESEARCH_ITERATIONS (default 6), RESEARCH_TARGETS (comma list).
import { execFile } from 'node:child_process';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const HARNESS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_CUI = join(HARNESS_ROOT, '..', 'Capability-UI');
const RESULTS = join(HARNESS_ROOT, 'research', 'results.tsv');
const PROGRAM = join(HARNESS_ROOT, 'research', 'program.md');

const ITERATIONS = Number(process.env.RESEARCH_ITERATIONS ?? 6);
const TARGETS = (process.env.RESEARCH_TARGETS ?? 'src/loop.ts,src/tools.ts,src/context.ts,src/provider.ts')
  .split(',').map(s => s.trim()).filter(Boolean);

function log(msg) { process.stdout.write(`[loop] ${msg}\n`); }

async function sh(cmd, cwd = HARNESS_ROOT) {
  return execFileP('bash', ['-lc', cmd], { cwd, maxBuffer: 64 * 1024 * 1024 });
}

async function tryBuildAndTest() {
  try {
    await sh('npm run build', REPO_CUI);
    await sh('npm run build');
    await sh('npm test');
    await sh('npm test', REPO_CUI);
    return true;
  } catch (error) {
    log(`build/test failed: ${String(error.stderr ?? error.message).slice(-300)}`);
    return false;
  }
}

async function runEval() {
  const { stdout } = await sh('node research/eval/run.mjs');
  const line = stdout.trim().split('\n').filter(Boolean).pop();
  return JSON.parse(line);
}

function better(candidate, best) {
  if (candidate.passes !== best.passes) return candidate.passes > best.passes;
  return candidate.totalTurns < best.totalTurns;
}

async function callResearcher(programText, targetPath, currentCode, best) {
  const system =
    'You are an autoresearch agent improving a TypeScript coding-agent harness. '
    + 'Propose ONE focused improvement to the single file shown. Output ONLY the complete new file '
    + 'contents inside a single ```ts fenced code block, with no commentary. Keep it minimal, typed, '
    + 'non-interactive, add no new dependencies, and never change public behavior that tests rely on.';
  const user =
    `# Research brief\n${programText}\n\n`
    + `# Current best metric\npasses=${best.passes}/${best.total} totalTurns=${best.totalTurns}\n\n`
    + `# Target file: ${targetPath}\n\`\`\`ts\n${currentCode}\n\`\`\`\n\n`
    + `Return the full improved ${targetPath} as a single \`\`\`ts block.`;
  const res = await fetch(`${process.env.OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL,
      temperature: 0,
      max_tokens: 8000,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`researcher HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content ?? '';
  const match = content.match(/```(?:ts|typescript)?\n([\s\S]*?)```/);
  return match ? match[1] : null;
}

async function main() {
  await writeFile(RESULTS, 'iter\ttarget\tbuild_tests\tpasses\ttotalTurns\tdecision\n');
  const programText = await readFile(PROGRAM, 'utf8');

  log('building baseline...');
  if (!(await tryBuildAndTest())) throw new Error('baseline does not build/test');
  let best = await runEval();
  log(`baseline metric: passes=${best.passes}/${best.total} totalTurns=${best.totalTurns}`);
  await appendFile(RESULTS, `0\t(baseline)\tok\t${best.passes}\t${best.totalTurns}\tbaseline\n`);

  for (let i = 1; i <= ITERATIONS; i++) {
    const target = TARGETS[(i - 1) % TARGETS.length];
    log(`iteration ${i}/${ITERATIONS} target=${target}`);
    const before = await readFile(join(HARNESS_ROOT, target), 'utf8');
    let proposal = null;
    try {
      proposal = await callResearcher(programText, target, before, best);
    } catch (error) {
      log(`researcher error: ${error.message}`);
    }
    if (!proposal || proposal.trim() === before.trim()) {
      log('no usable proposal; skipping');
      await appendFile(RESULTS, `${i}\t${target}\tskip\t${best.passes}\t${best.totalTurns}\tno_proposal\n`);
      continue;
    }
    await writeFile(join(HARNESS_ROOT, target), proposal);
    const buildOk = await tryBuildAndTest();
    if (!buildOk) {
      await sh(`git checkout -- ${target}`);
      await tryBuildAndTest();
      await appendFile(RESULTS, `${i}\t${target}\tfail\t${best.passes}\t${best.totalTurns}\trevert_build\n`);
      continue;
    }
    let candidate;
    try {
      candidate = await runEval();
    } catch (error) {
      log(`eval error: ${error.message}`);
      await sh(`git checkout -- ${target}`);
      await tryBuildAndTest();
      await appendFile(RESULTS, `${i}\t${target}\tok\t?\t?\trevert_eval_error\n`);
      continue;
    }
    if (better(candidate, best)) {
      await sh(`git add ${target} && git commit -m "autoresearch(${target}): passes=${candidate.passes} turns=${candidate.totalTurns} (was passes=${best.passes} turns=${best.totalTurns})"`);
      best = candidate;
      log(`ACCEPT: passes=${candidate.passes} totalTurns=${candidate.totalTurns}`);
      await appendFile(RESULTS, `${i}\t${target}\tok\t${candidate.passes}\t${candidate.totalTurns}\taccept\n`);
    } else {
      await sh(`git checkout -- ${target}`);
      await tryBuildAndTest();
      log(`REVERT: passes=${candidate.passes} totalTurns=${candidate.totalTurns} (best passes=${best.passes} turns=${best.totalTurns})`);
      await appendFile(RESULTS, `${i}\t${target}\tok\t${candidate.passes}\t${candidate.totalTurns}\trevert\n`);
    }
  }
  log(`done. final metric: passes=${best.passes}/${best.total} totalTurns=${best.totalTurns}`);
}

main().catch(error => { process.stderr.write(String(error?.stack ?? error) + '\n'); process.exit(1); });

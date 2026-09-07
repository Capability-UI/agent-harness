// Fetch a fixed subset of the real HumanEval benchmark (openai/openai_humaneval)
// from the HuggingFace datasets-server and cache it in-repo so the benchmark is
// reproducible and offline. Usage: node research/eval/fetch-humaneval.mjs [count]
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATASET = 'openai/openai_humaneval';
const CONFIG = 'openai_humaneval';
const SPLIT = 'test';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'data', 'humaneval.json');

async function fetchRows(offset, length) {
  const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(DATASET)}&config=${CONFIG}&split=${SPLIT}&offset=${offset}&length=${length}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HF rows HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return json.rows.map(r => r.row);
}

async function main() {
  const count = Number(process.argv[2] ?? 20);
  const rows = [];
  for (let offset = 0; offset < count; offset += 100) {
    // eslint-disable-next-line no-await-in-loop
    rows.push(...await fetchRows(offset, Math.min(100, count - offset)));
  }
  const problems = rows.slice(0, count).map(r => ({
    task_id: r.task_id,
    entry_point: r.entry_point,
    prompt: r.prompt,
    test: r.test,
  }));
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ dataset: DATASET, config: CONFIG, split: SPLIT, count: problems.length, problems }, null, 2) + '\n');
  process.stdout.write(`cached ${problems.length} HumanEval problems -> ${OUT}\n`);
}

main().catch(error => { process.stderr.write(String(error?.stack ?? error) + '\n'); process.exit(1); });

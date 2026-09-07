// Generic HuggingFace datasets-server fetcher: caches a fixed subset of any
// public dataset/config/split in-repo for reproducible, offline benchmarking.
// Usage: node research/eval/fetch-benchmark.mjs <dataset> <config> <split> <count> <outfile>
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

async function fetchRows(dataset, config, split, offset, length) {
  const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(dataset)}&config=${encodeURIComponent(config)}&split=${encodeURIComponent(split)}&offset=${offset}&length=${length}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HF rows HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).rows.map(r => r.row);
}

async function main() {
  const [dataset, config, split, countArg, outArg] = process.argv.slice(2);
  if (!dataset || !config || !split || !countArg || !outArg) {
    process.stderr.write('usage: fetch-benchmark.mjs <dataset> <config> <split> <count> <outfile>\n');
    process.exit(2);
  }
  const count = Number(countArg);
  const out = isAbsolute(outArg) ? outArg : join(HERE, outArg);
  const rows = [];
  for (let offset = 0; offset < count; offset += 100) {
    // eslint-disable-next-line no-await-in-loop
    rows.push(...await fetchRows(dataset, config, split, offset, Math.min(100, count - offset)));
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify({ dataset, config, split, count: rows.length, rows: rows.slice(0, count) }, null, 2) + '\n');
  process.stdout.write(`cached ${Math.min(rows.length, count)} rows of ${dataset}/${config}:${split} -> ${out}\n`);
}

main().catch(error => { process.stderr.write(String(error?.stack ?? error) + '\n'); process.exit(1); });

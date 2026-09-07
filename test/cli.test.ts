import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCli } from '../src/cli.js';
import { Workspace } from '../src/workspace.js';

test('tools lists CUP capabilities without a model key', async () => {
  const root = join(tmpdir(), `harness-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  let out = '';
  const code = await runCli(['tools', '--workspace', root], text => { out += text; });
  assert.equal(code, 0);
  assert.match(out, /workspace.read/);
  assert.match(out, /workspace.bash/);
});

test('init creates harness files', async () => {
  const root = join(tmpdir(), `harness-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const code = await runCli(['init', '--workspace', root], () => undefined);
  assert.equal(code, 0);
  const ws = new Workspace(root);
  const progress = await ws.readText('.harness/progress.md');
  assert.match(progress, /Progress/);
});

test('run without a key exits 1', async () => {
  const root = join(tmpdir(), `harness-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const prev = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  let out = '';
  const code = await runCli(['run', '--workspace', root, 'do a thing'], text => { out += text; });
  if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
  assert.equal(code, 1);
  assert.match(out, /OPENAI_API_KEY/);
});

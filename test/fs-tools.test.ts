import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { globWorkspace, runBash } from '../src/fs-tools.js';
import { Workspace } from '../src/workspace.js';

async function tempWorkspace(): Promise<Workspace> {
  const root = join(tmpdir(), `harness-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  return new Workspace(root);
}

test('glob *.md is non-recursive; **/*.md matches nested files', async () => {
  const ws = await tempWorkspace();
  await ws.writeText('root.md', 'a');
  await ws.writeText('docs/nested.md', 'b');
  await ws.writeText('docs/skip.txt', 'c');
  const rootOnly = await globWorkspace(ws, '*.md');
  assert.deepEqual(rootOnly.sort(), ['root.md']);
  const recursive = await globWorkspace(ws, '**/*.md');
  assert.deepEqual(recursive.sort(), ['docs/nested.md', 'root.md']);
  const oneDir = await globWorkspace(ws, 'docs/*.md');
  assert.deepEqual(oneDir, ['docs/nested.md']);
});

test('runBash timeout returns structured BASH_TIMEOUT instead of throwing', async () => {
  const ws = await tempWorkspace();
  const result = await runBash(ws, 'sleep 2', 80);
  assert.equal(result.timedOut, true);
  assert.equal(result.reason, 'BASH_TIMEOUT');
  assert.equal(result.exitCode, 124);
  assert.equal(result.timeoutMs, 80);
});

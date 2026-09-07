import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Workspace } from '../src/workspace.js';

async function tempWorkspace(): Promise<Workspace> {
  const root = join(tmpdir(), `harness-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  return new Workspace(root);
}

test('rejects paths outside the workspace', async () => {
  const ws = await tempWorkspace();
  assert.throws(() => ws.resolvePath('../secret'), /PATH_OUTSIDE_WORKSPACE/);
});

test('reads and writes inside the workspace', async () => {
  const ws = await tempWorkspace();
  await ws.writeText('src/a.ts', 'export const x = 1;\n');
  const text = await ws.readText('src/a.ts');
  assert.equal(text, 'export const x = 1;\n');
});

test('edit replaces a unique string', async () => {
  const ws = await tempWorkspace();
  await ws.writeText('n.txt', 'hello world');
  const result = await ws.editText('n.txt', 'world', 'agent');
  assert.equal(result.replacements, 1);
  assert.equal(await ws.readText('n.txt'), 'hello agent');
});

test('edit fails when the old string is missing', async () => {
  const ws = await tempWorkspace();
  await writeFile(join(ws.root, 'n.txt'), 'hello', 'utf8');
  await assert.rejects(ws.editText('n.txt', 'missing', 'x'), /OLD_STRING_NOT_FOUND/);
});

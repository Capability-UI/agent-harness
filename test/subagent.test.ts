import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { subject } from '@capability-ui/core';
import { openCupStore } from '../src/cup-store.js';
import { allowCapabilitiesFor, createHarnessCup } from '../src/host.js';
import {
  createSubagent,
  listSubagents,
  loadSubagent,
  subagentSubject,
} from '../src/subagent.js';
import { Workspace } from '../src/workspace.js';

async function tmpWorkspace(): Promise<Workspace> {
  const root = join(tmpdir(), `harness-${randomUUID()}`);
  await mkdir(join(root, '.harness'), { recursive: true });
  return new Workspace(root);
}

test('createSubagent writes spec + prompt, loadSubagent/listSubagents read them back', async () => {
  const workspace = await tmpWorkspace();
  const spec = await createSubagent(workspace, {
    name: 'reviewer',
    promptText: 'You are a careful code reviewer.\n',
  });
  assert.equal(spec.id, 'agent:sub:reviewer');
  assert.equal(spec.name, 'reviewer');
  // Default allow is the safe read-mostly set.
  assert.deepEqual(spec.allow, [
    'workspace.read',
    'workspace.glob',
    'workspace.grep',
    'harness.memory.read',
    'harness.memory.append_progress',
    'harness.skill.read',
    'harness.features.read',
  ]);

  const loaded = await loadSubagent(workspace, 'reviewer');
  assert.equal(loaded.spec.id, 'agent:sub:reviewer');
  assert.match(loaded.prompt, /careful code reviewer/);

  const list = await listSubagents(workspace);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.name, 'reviewer');
});

test('subagentSubject builds the expected subject id', async () => {
  const workspace = await tmpWorkspace();
  const sub = subagentSubject('reviewer', workspace.root);
  assert.equal(sub.id, 'agent:sub:reviewer');
});

test('loadSubagent throws a clear error when the subagent is missing', async () => {
  const workspace = await tmpWorkspace();
  await assert.rejects(() => loadSubagent(workspace, 'ghost'), /SUBAGENT_NOT_FOUND/);
});

test('createSubagent honours an explicit allow-list and rejects bad names', async () => {
  const workspace = await tmpWorkspace();
  const spec = await createSubagent(workspace, {
    name: 'builder',
    promptText: 'build things',
    allow: ['workspace.read', 'workspace.bash'],
  });
  assert.deepEqual(spec.allow, ['workspace.read', 'workspace.bash']);
  await assert.rejects(
    () => createSubagent(workspace, { name: 'bad name!', promptText: 'x' }),
    /INVALID_SUBAGENT_NAME/,
  );
});

test('CUP scoping: a subagent gets only its allowed capabilities', async () => {
  const workspace = await tmpWorkspace();
  const { cup } = createHarnessCup(workspace);
  const reviewer = subagentSubject('reviewer', workspace.root);
  allowCapabilitiesFor(cup, reviewer.id, ['workspace.read']);

  const view = await cup.project({
    subject: reviewer,
    goal: 'x',
    context: { purpose: 'coding' },
  });
  const ids = view.capabilities.map(item => item.id);
  assert.deepEqual(ids, ['workspace.read']);
  assert.ok(!ids.includes('workspace.bash'));

  // An ungranted capability is denied for this subject.
  const denied = await cup.execute({
    subject: reviewer,
    capability: 'workspace.bash',
    input: { command: 'echo hi' },
    purpose: 'coding',
    context: { purpose: 'coding', channel: 'cli' },
  });
  assert.equal(denied.status, 'denied');
  const writeAttempt = await cup.execute({
    subject: reviewer,
    capability: 'workspace.write',
    input: { path: 'SHOULD_NOT_EXIST.txt', content: 'nope' },
    purpose: 'coding',
    context: { purpose: 'coding', channel: 'cli' },
  });
  assert.equal(writeAttempt.status, 'denied');
  await assert.rejects(() => workspace.readText('SHOULD_NOT_EXIST.txt'));

  // The granted capability still works.
  await workspace.writeText('README.md', 'hello\n');
  const allowed = await cup.execute({
    subject: reviewer,
    capability: 'workspace.read',
    input: { path: 'README.md' },
    purpose: 'coding',
    context: { purpose: 'coding', channel: 'cli' },
  });
  assert.equal(allowed.status, 'succeeded');
});

test('memory isolation: coder can read a subagent, another subagent cannot', async () => {
  const workspace = await tmpWorkspace();
  const store = openCupStore(workspace);
  try {
    const reviewer = 'agent:sub:reviewer';
    const other = 'agent:sub:other';
    await store.appendProgress(reviewer, 'reviewer looked at the diff');

    // The main coder may read any subject's progress.
    assert.match(await store.readProgress('agent:coder', reviewer), /looked at the diff/);
    // The subagent may read its own progress.
    assert.match(await store.readProgress(reviewer, reviewer), /looked at the diff/);
    // A different subagent may not read it.
    await assert.rejects(() => store.readProgress(other, reviewer), /CUP_FORBIDDEN/);
  } finally {
    store.close();
  }
});

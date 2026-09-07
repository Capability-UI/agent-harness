import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { subject } from '@capability-ui/core';
import { createHarnessCup } from '../src/host.js';
import { Workspace } from '../src/workspace.js';

async function setup() {
  const root = join(tmpdir(), `harness-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const workspace = new Workspace(root);
  return { ...createHarnessCup(workspace), workspace };
}

test('deny by default for an unknown subject', async () => {
  const { cup } = await setup();
  const stranger = subject('agent:stranger', {}, true);
  const decision = await cup.authorize({
    subject: stranger,
    operation: 'execute',
    resource: { id: 'workspace.read' },
    context: { purpose: 'coding' },
  });
  assert.equal(decision.effect, 'deny');
  assert.equal(decision.reasonCode, 'NO_MATCHING_ALLOW');
});

test('coder may execute workspace.read and cannot invent tools', async () => {
  const { cup, coder, workspace } = await setup();
  await workspace.writeText('README.md', 'hi\n');
  const allowed = await cup.execute({
    subject: coder,
    capability: 'workspace.read',
    input: { path: 'README.md' },
    purpose: 'coding',
    context: { purpose: 'coding', channel: 'cli' },
  });
  assert.equal(allowed.status, 'succeeded');
  const denied = await cup.execute({
    subject: coder,
    capability: 'workspace.rmrf',
    input: {},
    purpose: 'coding',
    context: { purpose: 'coding', channel: 'cli' },
  });
  assert.equal(denied.status, 'denied');
});

test('project lists the ACI tool set', async () => {
  const { cup, coder } = await setup();
  const view = await cup.project({ subject: coder, goal: 'code', context: { purpose: 'coding' } });
  const ids = view.capabilities.map(item => item.id).sort();
  for (const required of ['workspace.read', 'workspace.write', 'workspace.edit', 'workspace.bash', 'workspace.glob', 'workspace.grep']) {
    assert.ok(ids.includes(required), required);
  }
});

test('coding capabilities carry meaningful tool descriptions and argument docs', async () => {
  const { cup, coder } = await setup();
  const view = await cup.project({ subject: coder, goal: 'code', context: { purpose: 'coding' } });
  for (const capability of view.capabilities) {
    assert.ok(
      capability.description && capability.description.length > 20,
      `${capability.id} should have a descriptive tool description`,
    );
    assert.notEqual(
      capability.description,
      `${capability.id} (${capability.risk} risk)`,
      `${capability.id} should not use the bare fallback description`,
    );
  }
  const edit = view.capabilities.find(capability => capability.id === 'workspace.edit');
  const props = (edit?.inputSchema as { properties?: Record<string, { description?: string }> }).properties ?? {};
  assert.ok(props.oldString?.description, 'workspace.edit oldString should document verbatim matching');
});

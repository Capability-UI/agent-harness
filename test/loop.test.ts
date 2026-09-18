import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openCupStore } from '../src/cup-store.js';
import { createHarnessCup } from '../src/host.js';
import { ensureHarnessLayout, loadHarnessState } from '../src/harness-state.js';
import { runAgentLoop, unauthorizedToolSpecs } from '../src/loop.js';
import type { LanguageModel } from '../src/provider.js';
import { runNamedSubagent } from '../src/run-subagent.js';
import { SessionLog } from '../src/session.js';
import { createSubagent } from '../src/subagent.js';
import { codingCapabilities } from '../src/tools.js';
import { Workspace } from '../src/workspace.js';

test('loop reads a file through CUP then stops', async () => {
  const root = join(tmpdir(), `harness-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const workspace = new Workspace(root);
  await ensureHarnessLayout(workspace);
  await workspace.writeText('hello.txt', 'world');
  const { cup, coder } = createHarnessCup(workspace);
  const state = await loadHarnessState(workspace);
  const session = new SessionLog(workspace, 't1');
  let calls = 0;
  const model: LanguageModel = {
    async complete() {
      calls += 1;
      if (calls === 1) {
        return {
          text: '',
          toolCalls: [{ id: 'c1', name: 'workspace.read', arguments: JSON.stringify({ path: 'hello.txt' }) }],
        };
      }
      return { text: 'The file says world.', toolCalls: [] };
    },
  };
  const result = await runAgentLoop({
    cup, coder, workspace, state, model, goal: 'read hello.txt', maxTurns: 5, session,
  });
  assert.equal(result.stopReason, 'model_halt');
  assert.match(result.text, /world/);
  const tool = session.events.find(event => event.kind === 'tool');
  assert.equal(tool?.kind, 'tool');
  if (tool?.kind === 'tool') assert.match(tool.observation, /world/);
});

test('malformed tool json is returned to the model instead of crashing', async () => {
  const root = join(tmpdir(), `harness-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const workspace = new Workspace(root);
  await ensureHarnessLayout(workspace);
  const { cup, coder } = createHarnessCup(workspace);
  const state = await loadHarnessState(workspace);
  const session = new SessionLog(workspace, 't2');
  let calls = 0;
  const model: LanguageModel = {
    async complete() {
      calls += 1;
      if (calls === 1) {
        return { text: '', toolCalls: [{ id: 'c1', name: 'workspace.read', arguments: 'not-json' }] };
      }
      return { text: 'recovered', toolCalls: [] };
    },
  };
  const result = await runAgentLoop({
    cup, coder, workspace, state, model, goal: 'read', maxTurns: 5, session,
  });
  assert.equal(result.text, 'recovered');
  assert.ok(session.events.some(event => event.kind === 'denied'));
});

test('scoped subagent write is denied with a receipt and does not create the file', async () => {
  const root = join(tmpdir(), `harness-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const workspace = new Workspace(root);
  await ensureHarnessLayout(workspace);
  await createSubagent(workspace, {
    name: 'notes-readonly',
    promptText: 'readonly',
    allow: ['workspace.read', 'workspace.glob'],
  });
  const store = openCupStore(workspace);
  try {
    const { cup } = createHarnessCup(workspace, store.receiptSink, store);
    const extraTools = unauthorizedToolSpecs(codingCapabilities(workspace, store), ['workspace.read', 'workspace.glob']);
    assert.ok(extraTools.some(tool => tool.name === 'workspace.write'));
    let calls = 0;
    const model: LanguageModel = {
      async complete(_messages, tools) {
        calls += 1;
        assert.ok(tools.some(tool => tool.name === 'workspace.write'));
        if (calls === 1) {
          return {
            text: '',
            toolCalls: [{
              id: 'w1',
              name: 'workspace.write',
              arguments: JSON.stringify({ path: 'SHOULD_NOT_EXIST.txt', content: 'hacked' }),
            }],
          };
        }
        return { text: 'could not write', toolCalls: [] };
      },
    };
    const result = await runNamedSubagent({
      workspace,
      name: 'notes-readonly',
      goal: 'write SHOULD_NOT_EXIST.txt',
      cup,
      model,
      store,
      extraTools,
      maxTurns: 4,
    });
    assert.equal(result.stopReason, 'model_halt');
    await assert.rejects(() => workspace.readText('SHOULD_NOT_EXIST.txt'));
    const denied = store.receiptSink.all().filter(receipt =>
      receipt.capability === 'workspace.write' && receipt.status === 'denied',
    );
    assert.ok(denied.length >= 1, 'expected a CUP deny receipt for workspace.write');
  } finally {
    store.close();
  }
});

test('harness.subagent.run launches a child in-process without workspace.bash', async () => {
  const root = join(tmpdir(), `harness-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const workspace = new Workspace(root);
  await ensureHarnessLayout(workspace);
  await createSubagent(workspace, {
    name: 'notes-auditor',
    promptText: 'You audit notes.',
    allow: ['workspace.read', 'workspace.glob'],
  });
  const { cup, coder, runtime } = createHarnessCup(workspace);
  let parentTurns = 0;
  const model: LanguageModel = {
    async complete(_messages, tools) {
      if (tools.some(tool => tool.name === 'harness.subagent.run')) {
        parentTurns += 1;
        if (parentTurns === 1) {
          return {
            text: '',
            toolCalls: [{
              id: 's1',
              name: 'harness.subagent.run',
              arguments: JSON.stringify({ name: 'notes-auditor', goal: 'child audit', maxTurns: 2 }),
            }],
          };
        }
        return { text: 'parent done', toolCalls: [] };
      }
      return { text: 'child finished in-process', toolCalls: [] };
    },
  };
  runtime.model = model;
  const state = await loadHarnessState(workspace);
  const session = new SessionLog(workspace, 'parent-1');
  const result = await runAgentLoop({
    cup, coder, workspace, state, model, goal: 'launch child', maxTurns: 5, session,
  });
  assert.match(result.text, /parent done/);
  const nested = session.events.find(event => event.kind === 'tool' && event.name === 'harness.subagent.run');
  assert.equal(nested?.kind, 'tool');
  if (nested?.kind === 'tool') {
    assert.match(nested.observation, /child finished in-process/);
    assert.match(nested.observation, /notes-auditor/);
  }
});

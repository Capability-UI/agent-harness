import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHarnessCup } from '../src/host.js';
import { ensureHarnessLayout, loadHarnessState } from '../src/harness-state.js';
import { runAgentLoop } from '../src/loop.js';
import type { LanguageModel } from '../src/provider.js';
import { SessionLog } from '../src/session.js';
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

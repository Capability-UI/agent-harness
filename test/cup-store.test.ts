import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Receipt } from '@capability-ui/core';
import { openCupStore } from '../src/cup-store.js';
import { Workspace } from '../src/workspace.js';

const CODER = 'agent:coder';
const REVIEWER = 'agent:sub:reviewer';

async function setup() {
  const root = join(tmpdir(), `harness-${randomUUID()}`);
  await mkdir(join(root, '.harness'), { recursive: true });
  const workspace = new Workspace(root);
  return { workspace, store: openCupStore(workspace) };
}

function fakeReceipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    id: randomUUID(),
    status: 'succeeded',
    actor: { id: CODER, type: 'agent' },
    capability: 'workspace.read',
    inputHash: 'hash',
    decision: {
      requestId: randomUUID(),
      effect: 'allow',
      reasonCode: 'MATCHED_ALLOW',
      matchedPolicies: [],
      obligations: [],
      policyVersion: '0',
    },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test('progress and memory_json round-trip per subject', async () => {
  const { store } = await setup();
  try {
    await store.appendProgress(CODER, 'did step one');
    await store.appendProgress(CODER, 'did step two');
    const progress = await store.readProgress(CODER, CODER);
    assert.match(progress, /did step one/);
    assert.match(progress, /did step two/);

    await store.writeMemoryJson(CODER, { plan: ['a', 'b'], count: 2 });
    const memory = await store.readMemoryJson(CODER, CODER);
    assert.deepEqual(memory, { plan: ['a', 'b'], count: 2 });

    // A different subject keeps its own separate rows.
    await store.appendProgress(REVIEWER, 'reviewer note');
    assert.match(await store.readProgress(REVIEWER, REVIEWER), /reviewer note/);
    assert.doesNotMatch(await store.readProgress(REVIEWER, REVIEWER), /did step one/);
  } finally {
    store.close();
  }
});

test('session events append and read back in order', async () => {
  const { store } = await setup();
  try {
    const runId = 'run-1';
    await store.appendSessionEvent(CODER, runId, { kind: 'user', text: 'hi' });
    await store.appendSessionEvent(CODER, runId, { kind: 'assistant', text: 'hello' });
    const events = await store.readSession(CODER, CODER, runId);
    assert.equal(events.length, 2);
    assert.deepEqual(events[0], { kind: 'user', text: 'hi' });
    assert.deepEqual(events[1], { kind: 'assistant', text: 'hello' });
  } finally {
    store.close();
  }
});

test('receipt persists and receiptSink.all reflects it', async () => {
  const { store } = await setup();
  try {
    const receipt = fakeReceipt();
    await store.receiptSink.append(receipt);
    const all = store.receiptSink.all();
    assert.ok(all.some(item => item.id === receipt.id));
    const persisted = await store.persistence.receipts();
    assert.ok(persisted.some(item => item.id === receipt.id));
    const found = store.receiptSink.find?.({ actorId: CODER }) ?? [];
    assert.ok(found.some(item => item.id === receipt.id));
    const none = store.receiptSink.find?.({ actorId: 'agent:nobody' }) ?? [];
    assert.equal(none.length, 0);
  } finally {
    store.close();
  }
});

test('access model: coder may read a sub-agent, sub-agent may not read coder', async () => {
  const { store } = await setup();
  try {
    await store.appendProgress(REVIEWER, 'reviewer progress');
    await store.writeMemoryJson(REVIEWER, { note: 'reviewer memory' });
    await store.appendSessionEvent(REVIEWER, 'run-x', { kind: 'user', text: 'review this' });

    await store.appendProgress(CODER, 'coder progress');
    await store.writeMemoryJson(CODER, { note: 'coder memory' });
    await store.appendSessionEvent(CODER, 'run-y', { kind: 'user', text: 'coder secret' });

    // The main coder may read any subject's memory and sessions.
    assert.match(await store.readProgress(CODER, REVIEWER), /reviewer progress/);
    assert.deepEqual(await store.readMemoryJson(CODER, REVIEWER), { note: 'reviewer memory' });
    const reviewerSession = await store.readSession(CODER, REVIEWER, 'run-x');
    assert.equal(reviewerSession.length, 1);

    // A sub-agent may read its own data.
    assert.match(await store.readProgress(REVIEWER, REVIEWER), /reviewer progress/);

    // A sub-agent may not read the coder's memory or sessions.
    await assert.rejects(() => store.readProgress(REVIEWER, CODER), /CUP_FORBIDDEN/);
    await assert.rejects(() => store.readMemoryJson(REVIEWER, CODER), /CUP_FORBIDDEN/);
    await assert.rejects(() => store.readSession(REVIEWER, CODER, 'run-y'), /CUP_FORBIDDEN/);
  } finally {
    store.close();
  }
});

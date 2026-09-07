import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSystemPrompt, maskObservations, type ChatMessage } from '../src/context.js';
import type { HarnessState } from '../src/harness-state.js';

const state: HarnessState = {
  prompt: 'You are a coding agent.',
  progress: 'Did nothing yet.',
  memory: {},
  featureList: [],
  skills: [{ name: 'git', description: 'Commit hygiene', path: 'x' }],
  subagents: [],
  agentsMd: 'Keep tests green.',
};

test('system prompt includes skill names without bodies', () => {
  const prompt = buildSystemPrompt(state, '/tmp/ws', 'fix tests');
  assert.match(prompt, /git: Commit hygiene/);
  assert.match(prompt, /Keep tests green/);
  assert.match(prompt, /fix tests/);
});

test('observation masking keeps only the last N tool results', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 's' },
    { role: 'user', content: 'u' },
    { role: 'assistant', content: 'a1', toolCalls: [{ id: '1', name: 'workspace.read', arguments: '{}' }] },
    { role: 'tool', content: 'A'.repeat(100), toolCallId: '1' },
    { role: 'assistant', content: 'a2', toolCalls: [{ id: '2', name: 'workspace.read', arguments: '{}' }] },
    { role: 'tool', content: 'B'.repeat(100), toolCallId: '2' },
    { role: 'assistant', content: 'a3', toolCalls: [{ id: '3', name: 'workspace.read', arguments: '{}' }] },
    { role: 'tool', content: 'C'.repeat(100), toolCallId: '3' },
  ];
  const masked = maskObservations(messages, 1);
  const tools = masked.filter(item => item.role === 'tool');
  assert.equal(tools[0]?.content.includes('omitted'), true);
  assert.equal(tools[1]?.content.includes('omitted'), true);
  assert.equal(tools[2]?.content, 'C'.repeat(100));
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createModel, createToolNameCodec, resolveModelConfig } from '../src/provider.js';

const OPENAI_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

test('tool name codec maps CUP ids to wire-safe names and back', () => {
  const ids = [
    'workspace.read',
    'workspace.bash',
    'harness.memory.read',
    'harness.memory.append_progress',
    'harness.features.read',
  ];
  const codec = createToolNameCodec(ids);
  for (const id of ids) {
    const wire = codec.toWire(id);
    assert.match(wire, OPENAI_NAME_PATTERN, `wire name for ${id} must satisfy OpenAI pattern`);
    assert.equal(codec.fromWire(wire), id, `round-trip must recover ${id}`);
  }
});

test('tool name codec disambiguates colliding sanitized names', () => {
  const codec = createToolNameCodec(['a.b', 'a-b']);
  const first = codec.toWire('a.b');
  const second = codec.toWire('a-b');
  assert.notEqual(first, second);
  assert.match(first, OPENAI_NAME_PATTERN);
  assert.match(second, OPENAI_NAME_PATTERN);
  assert.equal(codec.fromWire(first), 'a.b');
  assert.equal(codec.fromWire(second), 'a-b');
});

test('tool name codec passes through unknown names unchanged on fromWire', () => {
  const codec = createToolNameCodec(['workspace.read']);
  assert.equal(codec.fromWire('workspace_read'), 'workspace.read');
  assert.equal(codec.fromWire('unknown_name'), 'unknown_name');
});

test('resolveModelConfig uses env and defaults', () => {
  const prevKey = process.env.OPENAI_API_KEY;
  const prevBase = process.env.OPENAI_BASE_URL;
  const prevModel = process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = 'env-key';
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_MODEL;
  try {
    assert.deepEqual(resolveModelConfig(), {
      apiKey: 'env-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
    });
  } finally {
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevKey;
    if (prevBase === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = prevBase;
    if (prevModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = prevModel;
  }
});

test('resolveModelConfig prefers CLI overrides over env', () => {
  const prevKey = process.env.OPENAI_API_KEY;
  const prevBase = process.env.OPENAI_BASE_URL;
  const prevModel = process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = 'env-key';
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';
  process.env.OPENAI_MODEL = 'gpt-4.1-mini';
  try {
    assert.deepEqual(
      resolveModelConfig({
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'anthropic/claude-sonnet-4',
      }),
      {
        apiKey: 'env-key',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'anthropic/claude-sonnet-4',
      },
    );
  } finally {
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevKey;
    if (prevBase === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = prevBase;
    if (prevModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = prevModel;
  }
});

test('createModel returns undefined without a key', () => {
  const prevKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.equal(createModel(), undefined);
    assert.equal(createModel({ baseUrl: 'https://openrouter.ai/api/v1' }), undefined);
  } finally {
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevKey;
  }
});

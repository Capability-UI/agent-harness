import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createModel, resolveModelConfig } from '../src/provider.js';

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

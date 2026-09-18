import assert from 'node:assert/strict';
import { test } from 'node:test';
import { researchEvalOutcome } from '../src/eval-score.js';

test('research eval exits 1 when the API key is missing', () => {
  const outcome = researchEvalOutcome({ total: 4, tasks: [{ crashed: true }, { crashed: true }, { crashed: true }, { crashed: true }] }, false);
  assert.equal(outcome.code, 1);
  assert.match(outcome.message, /EVAL_NO_API_KEY/);
});

test('research eval exits 1 when every task crashed', () => {
  const outcome = researchEvalOutcome({ total: 2, tasks: [{ crashed: true }, { crashed: true }] }, true);
  assert.equal(outcome.code, 1);
  assert.match(outcome.message, /EVAL_ALL_CRASHED/);
});

test('research eval exits 0 when some tasks ran', () => {
  const outcome = researchEvalOutcome({ total: 2, tasks: [{ crashed: true }, { crashed: false }] }, true);
  assert.equal(outcome.code, 0);
  assert.equal(outcome.message, '');
});

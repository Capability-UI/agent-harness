import {
  defineCapability,
  type Capability,
  type ExecutionContext,
} from '@capability-ui/core';
import { DEFAULT_MAX_TURNS } from './constants.js';
import { unauthorizedToolSpecs } from './loop.js';
import { createModel } from './provider.js';
import type { HarnessRuntime } from './runtime.js';
import { runNamedSubagent } from './run-subagent.js';
import { loadSubagent } from './subagent.js';
import { codingCapabilities } from './tools.js';
import type { Workspace } from './workspace.js';

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

function str(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === 'string' ? value : '';
}

export function subagentRunCapability(workspace: Workspace, runtime: HarnessRuntime): Capability {
  return defineCapability({
    id: 'harness.subagent.run',
    operation: 'execute',
    version: '1.0',
    sensitivity: 'confidential',
    schema: { type: 'object' },
    outputSchema: { type: 'object' },
    confirmation: 'none',
    idempotency: 'none',
    description:
      'Run a saved named subagent in-process (not via workspace.bash). Prefer this over shelling out to `harness subagent run`, which is killed when it exceeds BASH_TIMEOUT_MS. Returns the child text, stop reason, and session id.',
    risk: 'high',
    sideEffects: ['process_spawn'],
    reversibility: 'irreversible',
    inputSchema: {
      type: 'object',
      required: ['name', 'goal'],
      properties: {
        name: { type: 'string', description: 'Saved subagent name (from harness subagent create).' },
        goal: { type: 'string', description: 'Goal prompt for this subagent session.' },
        maxTurns: { type: 'number', description: `Optional turn budget (default 20, cap ${DEFAULT_MAX_TURNS}).` },
      },
    },
    handler: async (input: unknown, context: ExecutionContext) => {
      const rec = asRecord(input);
      const name = str(rec, 'name');
      const goal = str(rec, 'goal');
      if (!name.trim()) throw new Error('SUBAGENT_NAME_REQUIRED');
      if (!goal.trim()) throw new Error('SUBAGENT_GOAL_REQUIRED');
      const cup = runtime.cup;
      if (!cup) throw new Error('SUBAGENT_RUN_NO_CUP');
      const model = runtime.model ?? createModel({});
      if (!model) throw new Error('SUBAGENT_RUN_NO_MODEL');
      const maxTurnsRaw = rec.maxTurns;
      const maxTurns = typeof maxTurnsRaw === 'number' && Number.isFinite(maxTurnsRaw) ? maxTurnsRaw : 20;
      const { spec } = await loadSubagent(workspace, name);
      const extraTools = unauthorizedToolSpecs(codingCapabilities(workspace, runtime.store), spec.allow);
      const result = await runNamedSubagent({
        workspace,
        name,
        goal,
        cup,
        model,
        store: runtime.store,
        maxTurns,
        parentSessionId: typeof context.requestId === 'string' ? context.requestId : undefined,
        extraTools,
      });
      return {
        name: result.name,
        subjectId: result.subjectId,
        text: result.text,
        turns: result.turns,
        stopReason: result.stopReason,
        sessionId: result.sessionId,
        parentRequestId: context.requestId,
      };
    },
  });
}

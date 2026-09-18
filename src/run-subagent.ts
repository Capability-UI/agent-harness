import { randomUUID } from 'node:crypto';
import { DEFAULT_MAX_TURNS } from './constants.js';
import { allowCapabilitiesFor } from './grants.js';
import { ensureHarnessLayout, loadHarnessState } from './harness-state.js';
import { runAgentLoop, type LoopResult } from './loop.js';
import type { LanguageModel, ToolSpec } from './provider.js';
import { SessionLog } from './session.js';
import { loadSubagent, subagentSubject } from './subagent.js';
import type { CapabilityUI } from '@capability-ui/core';
import type { CupStore } from './cup-store.js';
import type { Workspace } from './workspace.js';

export interface RunNamedSubagentResult extends LoopResult {
  name: string;
  subjectId: string;
  parentSessionId?: string;
}

export async function runNamedSubagent(options: {
  workspace: Workspace;
  name: string;
  goal: string;
  cup: CapabilityUI;
  model: LanguageModel;
  store?: CupStore;
  maxTurns?: number;
  parentSessionId?: string;
  extraTools?: ToolSpec[];
}): Promise<RunNamedSubagentResult> {
  await ensureHarnessLayout(options.workspace);
  const { spec, prompt } = await loadSubagent(options.workspace, options.name);
  const sub = subagentSubject(spec.name, options.workspace.root);
  allowCapabilitiesFor(options.cup, sub.id, spec.allow);
  const state = await loadHarnessState(options.workspace, options.store, sub.id);
  state.prompt = prompt;
  const session = new SessionLog(options.workspace, randomUUID(), options.store, sub.id);
  const maxTurns = Math.max(1, Math.min(options.maxTurns ?? DEFAULT_MAX_TURNS, DEFAULT_MAX_TURNS));
  const result = await runAgentLoop({
    cup: options.cup,
    coder: sub,
    workspace: options.workspace,
    state,
    model: options.model,
    goal: options.goal,
    maxTurns,
    session,
    extraTools: options.extraTools,
  });
  return {
    ...result,
    name: spec.name,
    subjectId: sub.id,
    parentSessionId: options.parentSessionId,
  };
}

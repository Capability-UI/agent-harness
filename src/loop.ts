import type { AuthorizedCapability, CapabilityUI, Subject } from '@capability-ui/core';
import type { ChatMessage, ToolCall } from './context.js';
import { buildSystemPrompt, maskObservations } from './context.js';
import type { HarnessState } from './harness-state.js';
import type { LanguageModel, ToolSpec } from './provider.js';
import { nowIso, SessionLog, type SessionEvent } from './session.js';
import type { Workspace } from './workspace.js';

export interface LoopResult {
  text: string;
  turns: number;
  stopReason: string;
  sessionId: string;
}

function toolsFromView(capabilities: AuthorizedCapability[]): ToolSpec[] {
  return capabilities.map(capability => ({
    name: capability.id,
    description: capability.description
      ? `${capability.description} (${capability.risk} risk)`
      : `${capability.id} (${capability.risk} risk)`,
    inputSchema: capability.inputSchema,
  }));
}

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { _invalid_json: raw };
  }
}

function observationFromReceipt(receipt: { status: string; resultSummary?: unknown; decision: { reasonCode: string } }): string {
  if (receipt.status === 'succeeded') {
    return typeof receipt.resultSummary === 'string'
      ? receipt.resultSummary
      : JSON.stringify(receipt.resultSummary, null, 2);
  }
  return `status=${receipt.status} reason=${receipt.decision.reasonCode} detail=${JSON.stringify(receipt.resultSummary ?? {})}`;
}

export async function runAgentLoop(options: {
  cup: CapabilityUI;
  coder: Subject;
  workspace: Workspace;
  state: HarnessState;
  model: LanguageModel;
  goal: string;
  maxTurns: number;
  session: SessionLog;
}): Promise<LoopResult> {
  const { cup, coder, workspace, state, model, goal, maxTurns, session } = options;
  const view = await cup.project({ subject: coder, goal, context: { purpose: 'coding', channel: 'cli', workspace: workspace.root } });
  const tools = toolsFromView(view.capabilities);
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(state, workspace.root, goal) },
    { role: 'user', content: goal },
  ];
  await session.append({ kind: 'user', at: nowIso(), text: goal });

  let lastText = '';
  for (let turn = 1; turn <= maxTurns; turn++) {
    const projected = maskObservations(messages);
    const assistant = await model.complete(projected, tools);
    lastText = assistant.text;
    messages.push({
      role: 'assistant',
      content: assistant.text,
      toolCalls: assistant.toolCalls.length ? assistant.toolCalls : undefined,
    });
    await session.append({ kind: 'assistant', at: nowIso(), text: assistant.text });

    if (assistant.toolCalls.length === 0) {
      const stop: SessionEvent = { kind: 'stop', at: nowIso(), reason: 'model_halt' };
      await session.append(stop);
      return { text: lastText, turns: turn, stopReason: 'model_halt', sessionId: session.id };
    }

    for (const call of assistant.toolCalls) {
      await dispatchTool({ cup, coder, workspace, session, messages, call });
    }
  }

  await session.append({ kind: 'stop', at: nowIso(), reason: 'max_turns' });
  return { text: lastText, turns: maxTurns, stopReason: 'max_turns', sessionId: session.id };
}

async function dispatchTool(options: {
  cup: CapabilityUI;
  coder: Subject;
  workspace: Workspace;
  session: SessionLog;
  messages: ChatMessage[];
  call: ToolCall;
}): Promise<void> {
  const { cup, coder, session, messages, call } = options;
  const input = parseArgs(call.arguments);
  if (input && typeof input === 'object' && '_invalid_json' in input) {
    const observation = 'Malformed tool arguments. Resend valid JSON.';
    messages.push({ role: 'tool', content: observation, toolCallId: call.id });
    await session.append({ kind: 'denied', at: nowIso(), name: call.name, reason: 'malformed_json' });
    return;
  }
  const receipt = await cup.execute({
    subject: coder,
    capability: call.name,
    input,
    purpose: 'coding',
    context: { purpose: 'coding', channel: 'cli', workspace: options.workspace.root },
  });
  const observation = observationFromReceipt(receipt);
  messages.push({ role: 'tool', content: observation, toolCallId: call.id });
  if (receipt.status === 'denied') {
    await session.append({ kind: 'denied', at: nowIso(), name: call.name, reason: receipt.decision.reasonCode });
    return;
  }
  await session.append({
    kind: 'tool',
    at: nowIso(),
    name: call.name,
    input,
    observation,
    receiptId: receipt.id,
    status: receipt.status,
  });
}

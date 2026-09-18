import './sqlite-warning.js';
import { denyByDefault, subject, type CapabilityUI, type ReceiptSink, type Subject } from '@capability-ui/core';
import type { CupStore } from './cup-store.js';
import { allowCapabilitiesFor } from './grants.js';
import type { HarnessRuntime } from './runtime.js';
import { subagentRunCapability } from './subagent-tool.js';
import { codingCapabilities } from './tools.js';
import type { Workspace } from './workspace.js';

export type { HarnessRuntime } from './runtime.js';
export { allowCapabilitiesFor } from './grants.js';

export const CODER_ID = 'agent:coder';

export function coderSubject(workspaceId: string): Subject {
  return subject(CODER_ID, { role: 'coder', workspaceId }, true);
}

export function createHarnessCup(
  workspace: Workspace,
  receipts?: ReceiptSink,
  store?: CupStore,
): { cup: CapabilityUI; coder: Subject; runtime: HarnessRuntime } {
  const runtime: HarnessRuntime = { store };
  const cup = denyByDefault(receipts ? { receipts } : undefined);
  const coder = coderSubject(workspace.root);
  const capabilities = [...codingCapabilities(workspace, store), subagentRunCapability(workspace, runtime)];
  for (const capability of capabilities) {
    cup.register(capability);
  }
  allowCapabilitiesFor(cup, coder.id, capabilities.map(capability => capability.id));
  runtime.cup = cup;
  return { cup, coder, runtime };
}

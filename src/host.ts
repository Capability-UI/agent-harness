import { denyByDefault, subject, type CapabilityUI, type ReceiptSink, type Subject } from '@capability-ui/core';
import type { CupStore } from './cup-store.js';
import { codingCapabilities } from './tools.js';
import type { Workspace } from './workspace.js';

export const CODER_ID = 'agent:coder';

export function coderSubject(workspaceId: string): Subject {
  return subject(CODER_ID, { role: 'coder', workspaceId }, true);
}

/** Grant a subject discover/inspect/execute allow policies for a set of
 * capability ids, mirroring the coder grants. Deny-by-default ensures the
 * subject gets nothing beyond the ids passed here. */
export function allowCapabilitiesFor(
  cup: CapabilityUI,
  subjectId: string,
  capabilityIds: string[],
): void {
  for (const capabilityId of capabilityIds) {
    cup.policy.allow({
      id: `${subjectId}-discover-${capabilityId}`,
      principal: { id: subjectId },
      operation: 'discover',
      resource: { id: capabilityId },
      priority: 10,
    });
    cup.policy.allow({
      id: `${subjectId}-inspect-${capabilityId}`,
      principal: { id: subjectId },
      operation: 'inspect',
      resource: { id: capabilityId },
      priority: 10,
    });
    cup.policy.allow({
      id: `${subjectId}-execute-${capabilityId}`,
      principal: { id: subjectId },
      operation: 'execute',
      resource: { id: capabilityId },
      priority: 10,
    });
  }
}

export function createHarnessCup(
  workspace: Workspace,
  receipts?: ReceiptSink,
  store?: CupStore,
): { cup: CapabilityUI; coder: Subject } {
  const cup = denyByDefault(receipts ? { receipts } : undefined);
  const coder = coderSubject(workspace.root);
  const capabilities = codingCapabilities(workspace, store);
  for (const capability of capabilities) {
    cup.register(capability);
  }
  allowCapabilitiesFor(cup, coder.id, capabilities.map(capability => capability.id));
  return { cup, coder };
}

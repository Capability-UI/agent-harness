import { denyByDefault, subject, type CapabilityUI, type Subject } from '@capability-ui/core';
import { codingCapabilities } from './tools.js';
import type { Workspace } from './workspace.js';

export const CODER_ID = 'agent:coder';

export function coderSubject(workspaceId: string): Subject {
  return subject(CODER_ID, { role: 'coder', workspaceId }, true);
}

export function createHarnessCup(workspace: Workspace): { cup: CapabilityUI; coder: Subject } {
  const cup = denyByDefault();
  const coder = coderSubject(workspace.root);
  for (const capability of codingCapabilities(workspace)) {
    cup.register(capability);
    cup.policy.allow({
      id: `${coder.id}-discover-${capability.id}`,
      principal: { id: coder.id },
      operation: 'discover',
      resource: { id: capability.id },
      priority: 10,
    });
    cup.policy.allow({
      id: `${coder.id}-inspect-${capability.id}`,
      principal: { id: coder.id },
      operation: 'inspect',
      resource: { id: capability.id },
      priority: 10,
    });
    cup.policy.allow({
      id: `${coder.id}-execute-${capability.id}`,
      principal: { id: coder.id },
      operation: 'execute',
      resource: { id: capability.id },
      priority: 10,
    });
  }
  return { cup, coder };
}

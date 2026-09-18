import type { CapabilityUI } from '@capability-ui/core';

/** Grant a subject discover/inspect/execute allow policies for a set of
 * capability ids. Deny-by-default ensures the subject gets nothing beyond
 * the ids passed here. */
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

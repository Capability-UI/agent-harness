import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { HARNESS_DIR, SESSIONS_DIR } from './constants.js';
import type { Workspace } from './workspace.js';

export type SessionEvent =
  | { kind: 'user'; at: string; text: string }
  | { kind: 'assistant'; at: string; text: string }
  | { kind: 'tool'; at: string; name: string; input: unknown; observation: string; receiptId: string; status: string }
  | { kind: 'denied'; at: string; name: string; reason: string }
  | { kind: 'stop'; at: string; reason: string };

export function describeSessionEvent(event: SessionEvent): string {
  switch (event.kind) {
    case 'user':
      return `user: ${event.text}`;
    case 'assistant':
      return `assistant: ${event.text}`;
    case 'tool':
      return `tool ${event.name} ${event.status}`;
    case 'denied':
      return `denied ${event.name}: ${event.reason}`;
    case 'stop':
      return `stop: ${event.reason}`;
    default: {
      const _never: never = event;
      return _never;
    }
  }
}

export class SessionLog {
  readonly id: string;
  readonly path: string;
  readonly events: SessionEvent[] = [];

  constructor(workspace: Workspace, id: string) {
    this.id = id;
    this.path = join(workspace.root, HARNESS_DIR, SESSIONS_DIR, `${id}.jsonl`);
  }

  async append(event: SessionEvent): Promise<void> {
    this.events.push(event);
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(event)}\n`, 'utf8');
  }

  static async load(workspace: Workspace, id: string): Promise<SessionLog> {
    const log = new SessionLog(workspace, id);
    try {
      const raw = await readFile(log.path, 'utf8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        log.events.push(JSON.parse(line) as SessionEvent);
      }
    } catch {
      // new session
    }
    return log;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

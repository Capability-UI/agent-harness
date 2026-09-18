import './sqlite-warning.js';
import {
  CUP_SQLITE_SCHEMA,
  SqliteCupPersistence,
  openNodeSqlite,
  type CupPersistence,
  type Receipt,
  type ReceiptQuery,
  type ReceiptSink,
  type SqlClient,
} from '@capability-ui/core';
import type { Workspace } from './workspace.js';

export const CODER_SUBJECT_ID = 'agent:coder';

const APP_SCHEMA = `
create table if not exists harness_memory (
  subject text not null,
  kind text not null,
  content text not null,
  updated_at text not null,
  primary key(subject, kind)
);
create table if not exists harness_sessions (
  subject text not null,
  run_id text not null,
  seq integer not null,
  event text not null,
  at text not null,
  primary key(subject, run_id, seq)
);
`;

export interface CupStore {
  readonly client: SqlClient;
  readonly persistence: CupPersistence;
  readonly receiptSink: ReceiptSink;
  readProgress(requester: string, owner: string): Promise<string>;
  appendProgress(subject: string, text: string): Promise<void>;
  readMemoryJson(requester: string, owner: string): Promise<unknown>;
  writeMemoryJson(subject: string, value: unknown): Promise<void>;
  appendSessionEvent(subject: string, runId: string, event: unknown): Promise<void>;
  readSession(requester: string, owner: string, runId: string): Promise<unknown[]>;
  close(): void;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Enforce the read access model: a subject may read its own data, and the main
 * coder subject may read any subject's data. Everything else is forbidden. */
function assertCanRead(requester: string, owner: string): void {
  if (requester === owner || requester === CODER_SUBJECT_ID) return;
  throw new Error('CUP_FORBIDDEN');
}

/** A ReceiptSink that durably persists each receipt through CUP persistence and
 * keeps an in-memory mirror so `all()`/`find()` stay synchronous. */
function createPersistentReceiptSink(persistence: CupPersistence): {
  sink: ReceiptSink;
  hydrate(): Promise<void>;
} {
  const mirror: Receipt[] = [];
  const seen = new Set<string>();
  const sink: ReceiptSink = {
    async append(receipt: Receipt): Promise<void> {
      await persistence.appendReceipt(receipt);
      if (!seen.has(receipt.id)) {
        seen.add(receipt.id);
        mirror.push(receipt);
      }
    },
    all(): Receipt[] {
      return [...mirror];
    },
    find(query: ReceiptQuery): Receipt[] {
      return mirror.filter(receipt => {
        if (query.actorId !== undefined && receipt.actor.id !== query.actorId) return false;
        if (query.capability !== undefined && receipt.capability !== query.capability) return false;
        if (query.status !== undefined && receipt.status !== query.status) return false;
        if (query.requestId !== undefined && receipt.decision.requestId !== query.requestId) return false;
        return true;
      });
    },
  };
  const hydrate = async (): Promise<void> => {
    const existing = await persistence.receipts();
    for (const receipt of existing) {
      if (seen.has(receipt.id)) continue;
      seen.add(receipt.id);
      mirror.push(receipt);
    }
  };
  return { sink, hydrate };
}

/** Open (and lazily create) the harness CUP database at `.harness/cup.db`,
 * apply the CUP core schema plus the harness app schema, and return the store. */
export function openCupStore(workspace: Workspace): CupStore {
  const handle = openNodeSqlite(workspace.join('.harness', 'cup.db'));
  handle.exec(CUP_SQLITE_SCHEMA);
  handle.exec(APP_SCHEMA);
  const client = handle.client;
  const persistence = new SqliteCupPersistence(client);
  const { sink, hydrate } = createPersistentReceiptSink(persistence);
  // Backfill the mirror from any receipts persisted in prior runs. Appends made
  // during this run dedupe against the hydrated set by receipt id.
  void hydrate();

  async function readMemoryRow(subject: string, kind: string): Promise<string | undefined> {
    const { rows } = await client.query<{ content: string }>(
      'select content from harness_memory where subject = ? and kind = ? limit 1',
      [subject, kind],
    );
    return rows[0]?.content;
  }

  async function upsertMemoryRow(subject: string, kind: string, content: string): Promise<void> {
    await client.query(
      `insert into harness_memory(subject, kind, content, updated_at) values(?, ?, ?, ?)
       on conflict(subject, kind) do update set content = excluded.content, updated_at = excluded.updated_at`,
      [subject, kind, content, nowIso()],
    );
  }

  return {
    client,
    persistence,
    receiptSink: sink,

    async readProgress(requester: string, owner: string): Promise<string> {
      assertCanRead(requester, owner);
      return (await readMemoryRow(owner, 'progress')) ?? '';
    },

    async appendProgress(subject: string, text: string): Promise<void> {
      const prev = (await readMemoryRow(subject, 'progress')) ?? '';
      const next = `${prev.trim()}\n\n${text.trim()}\n`.replace(/^\n+/, '');
      await upsertMemoryRow(subject, 'progress', next);
    },

    async readMemoryJson(requester: string, owner: string): Promise<unknown> {
      assertCanRead(requester, owner);
      const raw = await readMemoryRow(owner, 'memory_json');
      if (raw === undefined) return undefined;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return { error: 'invalid_json' };
      }
    },

    async writeMemoryJson(subject: string, value: unknown): Promise<void> {
      await upsertMemoryRow(subject, 'memory_json', JSON.stringify(value ?? {}));
    },

    async appendSessionEvent(subject: string, runId: string, event: unknown): Promise<void> {
      const { rows } = await client.query<{ next: number | null }>(
        'select max(seq) as next from harness_sessions where subject = ? and run_id = ?',
        [subject, runId],
      );
      const seq = (rows[0]?.next ?? 0) + 1;
      await client.query(
        'insert into harness_sessions(subject, run_id, seq, event, at) values(?, ?, ?, ?, ?)',
        [subject, runId, seq, JSON.stringify(event), nowIso()],
      );
    },

    async readSession(requester: string, owner: string, runId: string): Promise<unknown[]> {
      assertCanRead(requester, owner);
      const { rows } = await client.query<{ event: string }>(
        'select event from harness_sessions where subject = ? and run_id = ? order by seq asc',
        [owner, runId],
      );
      return rows.map(row => JSON.parse(row.event) as unknown);
    },

    close(): void {
      handle.close();
    },
  };
}

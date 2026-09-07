import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  defineCapability,
  type Capability,
  type ExecutionContext,
} from '@capability-ui/core';
import { FEATURE_LIST_FILE, HARNESS_DIR, MEMORY_FILE, PROGRESS_FILE } from './constants.js';
import { globWorkspace, grepWorkspace, runBash, formatBashObservation } from './fs-tools.js';
import { loadHarnessState } from './harness-state.js';
import { capObservationSync } from './observations.js';
import type { Workspace } from './workspace.js';

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

function str(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === 'string' ? value : '';
}

function capabilityBase(id: string, options: {
  risk: Capability['risk'];
  sideEffects: string[];
  reversibility: Capability['reversibility'];
  inputSchema: Capability['inputSchema'];
  handler: Capability['handler'];
}): Capability {
  return defineCapability({
    id,
    operation: 'execute',
    version: '1.0',
    sensitivity: 'confidential',
    schema: { type: 'object' },
    outputSchema: { type: 'object' },
    confirmation: 'none',
    idempotency: 'none',
    ...options,
  });
}

export function codingCapabilities(workspace: Workspace): Capability[] {
  return [
    capabilityBase('workspace.read', {
      risk: 'low',
      sideEffects: [],
      reversibility: 'reversible',
      inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
      handler: async (input: unknown, context: ExecutionContext) => {
        const path = str(asRecord(input), 'path');
        const content = await workspace.readText(path);
        return { path, content: await capObservationSync(content, workspace, `read-${context.requestId}`) };
      },
    }),
    capabilityBase('workspace.write', {
      risk: 'medium',
      sideEffects: ['filesystem_write'],
      reversibility: 'partially_reversible',
      inputSchema: {
        type: 'object',
        required: ['path', 'content'],
        properties: { path: { type: 'string' }, content: { type: 'string' } },
      },
      handler: async (input: unknown) => {
        const rec = asRecord(input);
        return workspace.writeText(str(rec, 'path'), str(rec, 'content'));
      },
    }),
    capabilityBase('workspace.edit', {
      risk: 'medium',
      sideEffects: ['filesystem_write'],
      reversibility: 'partially_reversible',
      inputSchema: {
        type: 'object',
        required: ['path', 'oldString', 'newString'],
        properties: {
          path: { type: 'string' },
          oldString: { type: 'string' },
          newString: { type: 'string' },
        },
      },
      handler: async (input: unknown) => {
        const rec = asRecord(input);
        return workspace.editText(str(rec, 'path'), str(rec, 'oldString'), str(rec, 'newString'));
      },
    }),
    capabilityBase('workspace.glob', {
      risk: 'low',
      sideEffects: [],
      reversibility: 'reversible',
      inputSchema: { type: 'object', required: ['pattern'], properties: { pattern: { type: 'string' } } },
      handler: async (input: unknown) => {
        const pattern = str(asRecord(input), 'pattern');
        return { pattern, files: await globWorkspace(workspace, pattern) };
      },
    }),
    capabilityBase('workspace.grep', {
      risk: 'low',
      sideEffects: [],
      reversibility: 'reversible',
      inputSchema: {
        type: 'object',
        required: ['pattern'],
        properties: { path: { type: 'string' }, pattern: { type: 'string' } },
      },
      handler: async (input: unknown, context: ExecutionContext) => {
        const rec = asRecord(input);
        const hits = await grepWorkspace(workspace, str(rec, 'pattern'), str(rec, 'path') || undefined);
        const text = hits.join('\n');
        return { hits: await capObservationSync(text, workspace, `grep-${context.requestId}`) };
      },
    }),
    capabilityBase('workspace.bash', {
      risk: 'high',
      sideEffects: ['process_spawn'],
      reversibility: 'irreversible',
      inputSchema: { type: 'object', required: ['command'], properties: { command: { type: 'string' } } },
      handler: async (input: unknown, context: ExecutionContext) => {
        const result = await runBash(workspace, str(asRecord(input), 'command'));
        const observation = await formatBashObservation(workspace, result, `bash-${context.requestId}`);
        return { ...result, observation };
      },
    }),
    capabilityBase('harness.memory.read', {
      risk: 'low',
      sideEffects: [],
      reversibility: 'reversible',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => loadHarnessState(workspace),
    }),
    capabilityBase('harness.memory.append_progress', {
      risk: 'low',
      sideEffects: ['filesystem_write'],
      reversibility: 'partially_reversible',
      inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } },
      handler: async (input: unknown) => {
        const path = join(HARNESS_DIR, PROGRESS_FILE);
        const prev = await workspace.readText(path).catch(() => '');
        const next = `${prev.trim()}\n\n${str(asRecord(input), 'text').trim()}\n`;
        return workspace.writeText(path, next);
      },
    }),
    capabilityBase('harness.memory.write_json', {
      risk: 'medium',
      sideEffects: ['filesystem_write'],
      reversibility: 'partially_reversible',
      inputSchema: { type: 'object', required: ['value'], properties: { value: { type: 'object' } } },
      handler: async (input: unknown) => {
        const value = asRecord(input).value ?? {};
        return workspace.writeText(join(HARNESS_DIR, MEMORY_FILE), `${JSON.stringify(value, null, 2)}\n`);
      },
    }),
    capabilityBase('harness.skill.read', {
      risk: 'low',
      sideEffects: [],
      reversibility: 'reversible',
      inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
      handler: async (input: unknown, context: ExecutionContext) => {
        const name = str(asRecord(input), 'name');
        const state = await loadHarnessState(workspace);
        const skill = state.skills.find(item => item.name === name);
        if (!skill) throw new Error('SKILL_NOT_FOUND');
        const body = await readFile(skill.path, 'utf8');
        return { name, path: skill.path, body: await capObservationSync(body, workspace, `skill-${context.requestId}`) };
      },
    }),
    capabilityBase('harness.features.read', {
      risk: 'low',
      sideEffects: [],
      reversibility: 'reversible',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const path = join(HARNESS_DIR, FEATURE_LIST_FILE);
        const raw = await workspace.readText(path).catch(() => '[]');
        return { path, value: JSON.parse(raw) as unknown };
      },
    }),
  ];
}

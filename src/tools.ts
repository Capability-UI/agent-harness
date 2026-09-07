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
  description: string;
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
      description: 'Read a UTF-8 text file from the workspace and return its contents. Use before editing to see exact text. Path must be relative to workspace root.',
      risk: 'low',
      sideEffects: [],
      reversibility: 'reversible',
      inputSchema: {
        type: 'object',
        required: ['path'],
        properties: { path: { type: 'string', description: 'Workspace-relative path to the file to read, e.g. src/index.ts.' } },
      },
      handler: async (input: unknown, context: ExecutionContext) => {
        const path = str(asRecord(input), 'path');
        const content = await workspace.readText(path);
        return { path, content: await capObservationSync(content, workspace, `read-${context.requestId}`) };
      },
    }),
    capabilityBase('workspace.write', {
      description: 'Create or overwrite a workspace file with the given content. Overwrites the whole file; prefer workspace.edit for surgical changes to an existing file.',
      risk: 'medium',
      sideEffects: ['filesystem_write'],
      reversibility: 'partially_reversible',
      inputSchema: {
        type: 'object',
        required: ['path', 'content'],
        properties: {
          path: { type: 'string', description: 'Workspace-relative path to write; parent directories are created as needed.' },
          content: { type: 'string', description: 'Full file content to write.' },
        },
      },
      handler: async (input: unknown) => {
        const rec = asRecord(input);
        return workspace.writeText(str(rec, 'path'), str(rec, 'content'));
      },
    }),
    capabilityBase('workspace.edit', {
      description: 'Replace one exact occurrence of oldString with newString in a file. CRITICAL: oldString must match the current file text verbatim (including whitespace) and be unique. ALWAYS call workspace.read first to verify the exact text before editing.',
      risk: 'medium',
      sideEffects: ['filesystem_write'],
      reversibility: 'partially_reversible',
      inputSchema: {
        type: 'object',
        required: ['path', 'oldString', 'newString'],
        properties: {
          path: { type: 'string', description: 'Workspace-relative path to the file to edit.' },
          oldString: { type: 'string', description: 'Exact text to find, matched verbatim; must be unique in the file.' },
          newString: { type: 'string', description: 'Replacement text for the single matched occurrence.' },
        },
      },
      handler: async (input: unknown) => {
        const rec = asRecord(input);
        return workspace.editText(str(rec, 'path'), str(rec, 'oldString'), str(rec, 'newString'));
      },
    }),
    capabilityBase('workspace.glob', {
      description: 'List workspace files matching a glob pattern. Use to discover files by name or extension. Supports recursive ** wildcards.',
      risk: 'low',
      sideEffects: [],
      reversibility: 'reversible',
      inputSchema: {
        type: 'object',
        required: ['pattern'],
        properties: { pattern: { type: 'string', description: 'Glob pattern relative to the workspace root, e.g. src/**/*.ts.' } },
      },
      handler: async (input: unknown) => {
        const pattern = str(asRecord(input), 'pattern');
        return { pattern, files: await globWorkspace(workspace, pattern) };
      },
    }),
    capabilityBase('workspace.grep', {
      description: 'Search workspace file contents for a regular expression and return matching lines. Use to locate code before reading or editing. Supports JavaScript regex syntax.',
      risk: 'low',
      sideEffects: [],
      reversibility: 'reversible',
      inputSchema: {
        type: 'object',
        required: ['pattern'],
        properties: {
          pattern: { type: 'string', description: 'Regular expression to search for in file contents.' },
          path: { type: 'string', description: 'Optional workspace-relative file or directory to limit the search; defaults to the whole workspace.' },
        },
      },
      handler: async (input: unknown, context: ExecutionContext) => {
        const rec = asRecord(input);
        const hits = await grepWorkspace(workspace, str(rec, 'pattern'), str(rec, 'path') || undefined);
        const text = hits.join('\n');
        return { hits: await capObservationSync(text, workspace, `grep-${context.requestId}`) };
      },
    }),
    capabilityBase('workspace.bash', {
      description: 'Run a shell command from the workspace root and return its stdout, stderr, and exit code. Use for building, running tests, or inspecting the environment. Quote all arguments containing spaces to prevent word splitting.',
      risk: 'high',
      sideEffects: ['process_spawn'],
      reversibility: 'irreversible',
      inputSchema: {
        type: 'object',
        required: ['command'],
        properties: { command: { type: 'string', description: 'Shell command to execute, e.g. "npm test".' } },
      },
      handler: async (input: unknown, context: ExecutionContext) => {
        const result = await runBash(workspace, str(asRecord(input), 'command'));
        const observation = await formatBashObservation(workspace, result, `bash-${context.requestId}`);
        return { ...result, observation };
      },
    }),
    capabilityBase('harness.memory.read', {
      description: 'Read the harness state: AGENTS.md, saved progress notes, skills catalog, and feature list. Call early to recover context.',
      risk: 'low',
      sideEffects: [],
      reversibility: 'reversible',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => loadHarnessState(workspace),
    }),
    capabilityBase('harness.memory.append_progress', {
      description: 'Append a short progress note to durable harness memory so later turns retain what was done and learned. Keep notes concise to save context window.',
      risk: 'low',
      sideEffects: ['filesystem_write'],
      reversibility: 'partially_reversible',
      inputSchema: {
        type: 'object',
        required: ['text'],
        properties: { text: { type: 'string', description: 'Progress note to append to memory.' } },
      },
      handler: async (input: unknown) => {
        const path = join(HARNESS_DIR, PROGRESS_FILE);
        const prev = await workspace.readText(path).catch(() => '');
        const next = `${prev.trim()}\n\n${str(asRecord(input), 'text').trim()}\n`;
        return workspace.writeText(path, next);
      },
    }),
    capabilityBase('harness.memory.write_json', {
      description: 'Persist a structured JSON object to harness memory, replacing the previous value. Use for durable structured state.',
      risk: 'medium',
      sideEffects: ['filesystem_write'],
      reversibility: 'partially_reversible',
      inputSchema: {
        type: 'object',
        required: ['value'],
        properties: { value: { type: 'object', description: 'JSON object to store as the memory value.' } },
      },
      handler: async (input: unknown) => {
        const value = asRecord(input).value ?? {};
        return workspace.writeText(join(HARNESS_DIR, MEMORY_FILE), `${JSON.stringify(value, null, 2)}\n`);
      },
    }),
    capabilityBase('harness.skill.read', {
      description: 'Load the full body of a named skill from the skills catalog (names are listed in harness.memory.read).',
      risk: 'low',
      sideEffects: [],
      reversibility: 'reversible',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string', description: 'Skill name to load, as listed in the skills catalog.' } },
      },
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
      description: 'Read the feature list with pass/fail status. Consult before claiming a feature works.',
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

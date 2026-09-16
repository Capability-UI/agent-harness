import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { subject, type Subject } from '@capability-ui/core';
import { AGENTS_DIR, HARNESS_DIR, PROMPT_FILE } from './constants.js';
import type { Workspace } from './workspace.js';

const SPEC_FILE = 'spec.json';
const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** Capabilities granted to a subagent when no explicit allow-list is given.
 * A deliberately read-mostly set: it can inspect the workspace and harness
 * memory but cannot write, edit, or run shell commands. */
export const DEFAULT_SUBAGENT_ALLOW: readonly string[] = [
  'workspace.read',
  'workspace.glob',
  'workspace.grep',
  'harness.memory.read',
  'harness.memory.append_progress',
  'harness.skill.read',
  'harness.features.read',
];

export interface SubagentSpec {
  id: string;
  name: string;
  displayName?: string;
  model?: string;
  allow: string[];
  createdAt: string;
  updatedAt: string;
}

function assertValidName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`INVALID_SUBAGENT_NAME: ${name} must match ${NAME_PATTERN.source}`);
  }
}

export function subagentSubjectId(name: string): string {
  return `agent:sub:${name}`;
}

export function subagentSubject(name: string, workspaceId: string): Subject {
  return subject(subagentSubjectId(name), { role: 'subagent', name, workspaceId }, true);
}

function agentDir(workspace: Workspace, name: string): string {
  return workspace.join(HARNESS_DIR, AGENTS_DIR, name);
}

export async function createSubagent(
  workspace: Workspace,
  opts: {
    name: string;
    promptText: string;
    allow?: string[];
    displayName?: string;
    model?: string;
  },
): Promise<SubagentSpec> {
  assertValidName(opts.name);
  const now = new Date().toISOString();
  const spec: SubagentSpec = {
    id: subagentSubjectId(opts.name),
    name: opts.name,
    allow: opts.allow && opts.allow.length > 0 ? [...opts.allow] : [...DEFAULT_SUBAGENT_ALLOW],
    createdAt: now,
    updatedAt: now,
  };
  if (opts.displayName !== undefined) spec.displayName = opts.displayName;
  if (opts.model !== undefined) spec.model = opts.model;

  const dir = agentDir(workspace, opts.name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, SPEC_FILE), `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  await writeFile(join(dir, PROMPT_FILE), opts.promptText, 'utf8');
  return spec;
}

export async function loadSubagent(
  workspace: Workspace,
  name: string,
): Promise<{ spec: SubagentSpec; prompt: string }> {
  assertValidName(name);
  const dir = agentDir(workspace, name);
  let rawSpec: string;
  try {
    rawSpec = await readFile(join(dir, SPEC_FILE), 'utf8');
  } catch {
    throw new Error(`SUBAGENT_NOT_FOUND: ${name}`);
  }
  let spec: SubagentSpec;
  try {
    spec = JSON.parse(rawSpec) as SubagentSpec;
  } catch {
    throw new Error(`SUBAGENT_SPEC_INVALID: ${name}`);
  }
  const prompt = await readFile(join(dir, PROMPT_FILE), 'utf8').catch(() => '');
  return { spec, prompt };
}

export async function listSubagents(workspace: Workspace): Promise<SubagentSpec[]> {
  const root = workspace.join(HARNESS_DIR, AGENTS_DIR);
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const specs: SubagentSpec[] = [];
  for (const name of names.sort()) {
    if (!NAME_PATTERN.test(name)) continue;
    try {
      const raw = await readFile(join(root, name, SPEC_FILE), 'utf8');
      specs.push(JSON.parse(raw) as SubagentSpec);
    } catch {
      continue;
    }
  }
  return specs;
}

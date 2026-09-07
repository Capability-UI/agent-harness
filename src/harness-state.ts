import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AGENTS_DIR,
  FEATURE_LIST_FILE,
  HARNESS_DIR,
  MEMORY_FILE,
  PROGRESS_FILE,
  PROMPT_FILE,
  SKILLS_DIR,
  SKILL_INDEX_DESC_CAP,
} from './constants.js';
import type { Workspace } from './workspace.js';

export interface SkillIndexEntry {
  name: string;
  description: string;
  path: string;
}

export interface HarnessState {
  prompt: string;
  progress: string;
  memory: unknown;
  featureList: unknown;
  skills: SkillIndexEntry[];
  subagents: SkillIndexEntry[];
  agentsMd: string;
}

function stripFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  if (!raw.startsWith('---')) return { meta: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return { meta: {}, body: raw };
  const block = raw.slice(4, end).trim();
  const body = raw.slice(end + 4).replace(/^\s+/, '');
  const meta: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) meta[key] = value;
  }
  return { meta, body };
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

async function parseJsonFile(path: string): Promise<unknown> {
  const raw = await readOptional(path);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { error: 'invalid_json', path };
  }
}

async function listMarkdownEntries(dir: string): Promise<SkillIndexEntry[]> {
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const entries: SkillIndexEntry[] = [];
  for (const name of names) {
    const skillMd = join(dir, name, 'SKILL.md');
    const standalone = name.endsWith('.md') ? join(dir, name) : skillMd;
    const raw = await readOptional(standalone);
    if (!raw) continue;
    const { meta, body } = stripFrontmatter(raw);
    const firstLine = body.trim().split('\n')[0] ?? '';
    const description = (meta.description ?? firstLine).slice(0, SKILL_INDEX_DESC_CAP);
    entries.push({
      name: meta.name ?? name.replace(/\.md$/, ''),
      description,
      path: standalone,
    });
  }
  return entries;
}

export async function ensureHarnessLayout(workspace: Workspace): Promise<void> {
  const root = workspace.join(HARNESS_DIR);
  await mkdir(join(root, SKILLS_DIR), { recursive: true });
  await mkdir(join(root, AGENTS_DIR), { recursive: true });
  await mkdir(join(root, 'sessions'), { recursive: true });
  await mkdir(join(root, 'artifacts'), { recursive: true });
  const promptPath = join(root, PROMPT_FILE);
  if (!(await readOptional(promptPath))) {
    await writeFile(promptPath, 'You are a coding agent. Prefer small, tested changes. Use tools instead of guessing file contents.\n', 'utf8');
  }
  const progressPath = join(root, PROGRESS_FILE);
  if (!(await readOptional(progressPath))) {
    await writeFile(progressPath, '# Progress\n\nNo sessions yet.\n', 'utf8');
  }
  const memoryPath = join(root, MEMORY_FILE);
  if (!(await readOptional(memoryPath))) {
    await writeFile(memoryPath, '{}\n', 'utf8');
  }
  const featuresPath = join(root, FEATURE_LIST_FILE);
  if (!(await readOptional(featuresPath))) {
    await writeFile(featuresPath, '[]\n', 'utf8');
  }
}

export async function loadHarnessState(workspace: Workspace): Promise<HarnessState> {
  const root = workspace.join(HARNESS_DIR);
  const repoSkills = await listMarkdownEntries(workspace.join('skills'));
  const harnessSkills = await listMarkdownEntries(join(root, SKILLS_DIR));
  return {
    prompt: await readOptional(join(root, PROMPT_FILE)),
    progress: await readOptional(join(root, PROGRESS_FILE)),
    memory: await parseJsonFile(join(root, MEMORY_FILE)),
    featureList: await parseJsonFile(join(root, FEATURE_LIST_FILE)),
    skills: [...harnessSkills, ...repoSkills],
    subagents: await listMarkdownEntries(join(root, AGENTS_DIR)),
    agentsMd: await readOptional(workspace.join('AGENTS.md')),
  };
}

export function skillCatalogText(skills: SkillIndexEntry[]): string {
  if (skills.length === 0) return '(none indexed; add SKILL.md under .harness/skills or skills/)';
  return skills.map(skill => `- ${skill.name}: ${skill.description}`).join('\n');
}

import { spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { BASH_TIMEOUT_MS } from './constants.js';
import { capObservationSync } from './observations.js';
import type { Workspace } from './workspace.js';

const SKIP_DIR = new Set(['.git', 'node_modules', 'dist', '.harness']);

function matchGlob(relPath: string, pattern: string): boolean {
  const normalized = pattern.replace(/\\/g, '/');
  const value = relPath.replace(/\\/g, '/');
  if (normalized.startsWith('**/')) {
    const rest = normalized.slice(3);
    return value === rest || value.endsWith(`/${rest}`) || globStar(value, normalized);
  }
  return globStar(value, normalized);
}

function globStar(value: string, pattern: string): boolean {
  const regex = new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '::DOUBLE::')
      .replace(/\*/g, '[^/]*')
      .replace(/::DOUBLE::/g, '.*')}$`,
  );
  return regex.test(value);
}

export async function walkFiles(root: string, acc: string[] = [], dir = root): Promise<string[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (SKIP_DIR.has(name)) continue;
    const abs = join(dir, name);
    const info = await stat(abs);
    if (info.isDirectory()) await walkFiles(root, acc, abs);
    else if (info.isFile()) acc.push(abs);
  }
  return acc;
}

export async function globWorkspace(workspace: Workspace, pattern: string): Promise<string[]> {
  const files = await walkFiles(workspace.root);
  const hits: string[] = [];
  for (const abs of files) {
    const rel = relative(workspace.root, abs);
    if (matchGlob(rel, pattern)) hits.push(rel);
  }
  return hits.slice(0, 200);
}

export async function grepWorkspace(workspace: Workspace, pattern: string, pathPrefix?: string): Promise<string[]> {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    throw new Error('INVALID_GREP_PATTERN');
  }
  const files = await walkFiles(workspace.root);
  const lines: string[] = [];
  for (const abs of files) {
    const rel = relative(workspace.root, abs);
    if (pathPrefix && !rel.startsWith(pathPrefix.replace(/^\.\//, ''))) continue;
    let text: string;
    try {
      text = await workspace.readText(rel);
    } catch {
      continue;
    }
    const fileLines = text.split('\n');
    for (let i = 0; i < fileLines.length; i++) {
      const line = fileLines[i];
      if (line !== undefined && regex.test(line)) {
        lines.push(`${rel}:${i + 1}:${line}`);
        if (lines.length >= 200) return lines;
      }
    }
  }
  return lines;
}

export async function runBash(workspace: Workspace, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (!command.trim()) throw new Error('COMMAND_REQUIRED');
  return new Promise((resolvePromise, reject) => {
    const child = spawn('bash', ['-lc', command], {
      cwd: workspace.root,
      env: { ...process.env, TERM: 'dumb' },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('BASH_TIMEOUT'));
    }, BASH_TIMEOUT_MS);
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

export async function formatBashObservation(workspace: Workspace, result: { stdout: string; stderr: string; exitCode: number }, label: string): Promise<string> {
  const raw = `exit ${result.exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
  return capObservationSync(raw, workspace, label);
}

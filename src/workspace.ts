import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export class Workspace {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  resolvePath(input: string): string {
    if (!input || input.trim() === '') throw new Error('PATH_REQUIRED');
    const abs = resolve(this.root, input);
    this.assertInside(abs);
    return abs;
  }

  assertInside(abs: string): void {
    const rel = relative(this.root, abs);
    if (rel === '') return;
    if (isAbsolute(rel) || rel.split(sep)[0] === '..') {
      throw new Error('PATH_OUTSIDE_WORKSPACE');
    }
  }

  async resolveExisting(input: string): Promise<string> {
    const abs = this.resolvePath(input);
    const real = await realpath(abs);
    this.assertInside(real);
    return real;
  }

  async readText(input: string): Promise<string> {
    const abs = await this.resolveExisting(input);
    const info = await stat(abs);
    if (!info.isFile()) throw new Error('NOT_A_FILE');
    return readFile(abs, 'utf8');
  }

  async writeText(input: string, content: string): Promise<{ path: string; bytes: number }> {
    const abs = this.resolvePath(input);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
    return { path: relative(this.root, abs) || '.', bytes: Buffer.byteLength(content) };
  }

  async editText(input: string, oldString: string, newString: string): Promise<{ path: string; replacements: number }> {
    if (oldString === '') throw new Error('OLD_STRING_REQUIRED');
    const current = await this.readText(input);
    const parts = current.split(oldString);
    const replacements = parts.length - 1;
    if (replacements === 0) throw new Error('OLD_STRING_NOT_FOUND');
    await this.writeText(input, parts.join(newString));
    return { path: input, replacements };
  }

  rel(abs: string): string {
    const rel = relative(this.root, abs);
    return rel === '' ? '.' : rel;
  }

  join(...parts: string[]): string {
    return join(this.root, ...parts);
  }
}

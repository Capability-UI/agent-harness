import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ARTIFACTS_DIR, HARNESS_DIR, OBSERVATION_CHAR_CAP } from './constants.js';
import type { Workspace } from './workspace.js';

export async function capObservationSync(text: string, workspace: Workspace, label: string): Promise<string> {
  if (text.length <= OBSERVATION_CHAR_CAP) return text;
  const file = join(HARNESS_DIR, ARTIFACTS_DIR, `${label}.txt`);
  await mkdir(workspace.join(HARNESS_DIR, ARTIFACTS_DIR), { recursive: true });
  await writeFile(workspace.join(file), text, 'utf8');
  return `${text.slice(0, OBSERVATION_CHAR_CAP)}\n\n[truncated ${text.length - OBSERVATION_CHAR_CAP} chars; full output at ${file}]`;
}

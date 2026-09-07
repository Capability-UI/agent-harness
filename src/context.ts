import { AGENTS_MD_BYTE_BUDGET, KEEP_LAST_FULL_OBSERVATIONS } from './constants.js';
import { skillCatalogText, type HarnessState } from './harness-state.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export function buildSystemPrompt(state: HarnessState, workspaceRoot: string, goal: string): string {
  const agents = state.agentsMd.length <= AGENTS_MD_BYTE_BUDGET
    ? state.agentsMd
    : `${state.agentsMd.slice(0, AGENTS_MD_BYTE_BUDGET)}\n\n[AGENTS.md truncated; read the file for the rest]`;
  const progressPreview = state.progress.slice(0, 2000);
  return [
    state.prompt.trim() || 'You are a coding agent.',
    '',
    '## Workspace',
    workspaceRoot,
    '',
    '## Goal',
    goal,
    '',
    '## AGENTS.md',
    agents || '(none)',
    '',
    '## Skills (name and description only; call harness.skill.read to load a body)',
    skillCatalogText(state.skills),
    '',
    '## Sub-agent specs',
    skillCatalogText(state.subagents),
    '',
    '## Progress (prefix)',
    progressPreview || '(empty)',
    '',
    '## Tool rules',
    'Use workspace.* tools for files and commands. Prefer workspace.edit for surgical changes.',
    'Do not claim a feature passes unless harness.features.read shows passes true or tests you ran succeeded.',
    'Large outputs may be truncated to a workspace artifact path; read that path if you need more.',
  ].join('\n');
}

export function maskObservations(messages: ChatMessage[], keepLast = KEEP_LAST_FULL_OBSERVATIONS): ChatMessage[] {
  const toolIndexes: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === 'tool') toolIndexes.push(i);
  }
  const keep = new Set(toolIndexes.slice(-keepLast));
  return messages.map((message, index) => {
    if (message.role !== 'tool' || keep.has(index)) return message;
    const lines = message.content.split('\n').length;
    return { ...message, content: `Old tool output: (${lines} lines omitted)` };
  });
}

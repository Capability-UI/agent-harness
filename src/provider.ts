import { DEFAULT_MODEL } from './constants.js';
import type { ChatMessage, ToolCall } from './context.js';

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AssistantTurn {
  text: string;
  toolCalls: ToolCall[];
}

export interface LanguageModel {
  complete(messages: ChatMessage[], tools: ToolSpec[]): Promise<AssistantTurn>;
}

interface OpenAiToolCall {
  id?: string;
  function?: { name?: string; arguments?: unknown };
}

interface OpenAiMessage {
  content?: string | null | Array<{ text?: string | { value?: string } } | string>;
  tool_calls?: OpenAiToolCall[];
}

export interface ToolNameCodec {
  toWire(name: string): string;
  fromWire(name: string): string;
}

const OPENAI_FUNCTION_NAME_PATTERN = /[^a-zA-Z0-9_-]/g;

function sanitizeToolName(name: string): string {
  const cleaned = name.replace(OPENAI_FUNCTION_NAME_PATTERN, '_');
  return cleaned.length > 0 ? cleaned : 'tool';
}

// CUP capability ids (e.g. `workspace.read`) contain dots, but OpenAI-compatible
// function-calling APIs require names matching `^[a-zA-Z0-9_-]+$`. Map ids to
// wire-safe names and back through an explicit table, because reversing by string
// substitution is ambiguous for ids like `harness.memory.append_progress`.
export function createToolNameCodec(originalNames: Iterable<string>): ToolNameCodec {
  const toWireMap = new Map<string, string>();
  const fromWireMap = new Map<string, string>();
  const used = new Set<string>();
  for (const original of originalNames) {
    if (toWireMap.has(original)) continue;
    const base = sanitizeToolName(original);
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}_${suffix++}`;
    }
    used.add(candidate);
    toWireMap.set(original, candidate);
    fromWireMap.set(candidate, original);
  }
  return {
    toWire: name => toWireMap.get(name) ?? sanitizeToolName(name),
    fromWire: name => fromWireMap.get(name) ?? name,
  };
}

const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

function flattenContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';
  if (Array.isArray(content)) {
    let out = '';
    for (const part of content) {
      if (typeof part === 'string') {
        out += part;
      } else if (part !== null && typeof part === 'object') {
        const record = part as { text?: unknown };
        if (typeof record.text === 'string') out += record.text;
        else if (record.text !== null && typeof record.text === 'object') {
          const inner = (record.text as { value?: unknown }).value;
          if (typeof inner === 'string') out += inner;
        }
      }
    }
    return out;
  }
  return '';
}

// Reasoning models (e.g. Qwen) leak chain-of-thought into the assistant `content`
// field, either as <think>...</think> blocks or as a preamble terminated by a
// stray </think>. Keep only the post-reasoning answer: drop balanced <think>
// blocks, and if a closing tag remains, keep only what follows the last one.
// Applied to the user-facing final answer (see cli.ts) rather than the replayed
// message history, so in-context reasoning is preserved for the agent loop.
export function stripReasoning(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const lastClose = out.toLowerCase().lastIndexOf('</think>');
  if (lastClose !== -1) out = out.slice(lastClose + '</think>'.length);
  return out.trim();
}

function normalizeText(content: unknown): string {
  return flattenContent(content);
}

function normalizeArguments(args: unknown): string {
  if (typeof args === 'string') {
    if (args.trim().length === 0) return '{}';
    return args;
  }
  if (args === null || args === undefined) return '{}';
  try {
    return JSON.stringify(args);
  } catch {
    return '{}';
  }
}

export class OpenAiCompatibleModel implements LanguageModel {
  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl: string;
      model: string;
    },
  ) {}

  async complete(messages: ChatMessage[], tools: ToolSpec[]): Promise<AssistantTurn> {
    const url = `${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const originalNames = new Set<string>();
    for (const tool of tools) originalNames.add(tool.name);
    for (const message of messages) {
      if (message.role === 'assistant' && message.toolCalls) {
        for (const call of message.toolCalls) originalNames.add(call.name);
      }
    }
    const codec = createToolNameCodec(originalNames);
    const body = {
      model: this.options.model,
      messages: messages.map(message => {
        if (message.role === 'tool') {
          return { role: 'tool', content: message.content, tool_call_id: message.toolCallId };
        }
        if (message.role === 'assistant' && message.toolCalls?.length) {
          return {
            role: 'assistant',
            content: message.content || null,
            tool_calls: message.toolCalls.map(call => ({
              id: call.id,
              type: 'function',
              function: { name: codec.toWire(call.name), arguments: call.arguments },
            })),
          };
        }
        return { role: message.role, content: message.content };
      }),
      tools: tools.map(tool => ({
        type: 'function',
        function: { name: codec.toWire(tool.name), description: tool.description, parameters: tool.inputSchema },
      })),
    };
    const payload = JSON.stringify(body);
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.options.apiKey}`,
          },
          body: payload,
        });
      } catch (error) {
        lastError = error;
        if (attempt < MAX_ATTEMPTS - 1) {
          await sleep(150 * 2 ** attempt);
          continue;
        }
        throw error;
      }
      if (!response.ok) {
        const detail = await response.text();
        const error = new Error(`MODEL_HTTP_${response.status}: ${detail.slice(0, 500)}`);
        lastError = error;
        if (isRetryableStatus(response.status) && attempt < MAX_ATTEMPTS - 1) {
          await sleep(150 * 2 ** attempt);
          continue;
        }
        throw error;
      }
      const json = await response.json() as { choices?: Array<{ message?: OpenAiMessage }> };
      const message = json.choices?.[0]?.message;
      const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((call, index) => ({
        id: call.id ?? `call_${index}`,
        name: codec.fromWire(typeof call.function?.name === 'string' ? call.function.name : ''),
        arguments: normalizeArguments(call.function?.arguments),
      }));
      return { text: normalizeText(message?.content), toolCalls };
    }
    throw lastError instanceof Error ? lastError : new Error('MODEL_HTTP_UNKNOWN: request failed');
  }
}

export interface ModelConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function resolveModelConfig(overrides?: Partial<ModelConfig>): ModelConfig | undefined {
  const apiKey = overrides?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return undefined;
  return {
    apiKey,
    baseUrl: overrides?.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    model: overrides?.model ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL,
  };
}

export function createModel(overrides?: Partial<ModelConfig>): OpenAiCompatibleModel | undefined {
  const config = resolveModelConfig(overrides);
  if (!config) return undefined;
  return new OpenAiCompatibleModel(config);
}

export function modelFromEnv(): OpenAiCompatibleModel | undefined {
  return createModel();
}

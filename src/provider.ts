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
  function?: { name?: string; arguments?: string };
}

interface OpenAiMessage {
  content?: string | null;
  tool_calls?: OpenAiToolCall[];
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
              function: { name: call.name, arguments: call.arguments },
            })),
          };
        }
        return { role: message.role, content: message.content };
      }),
      tools: tools.map(tool => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
      })),
    };
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`MODEL_HTTP_${response.status}: ${detail.slice(0, 500)}`);
    }
    const json = await response.json() as { choices?: Array<{ message?: OpenAiMessage }> };
    const message = json.choices?.[0]?.message;
    const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((call, index) => ({
      id: call.id ?? `call_${index}`,
      name: call.function?.name ?? '',
      arguments: call.function?.arguments ?? '{}',
    }));
    return { text: message?.content ?? '', toolCalls };
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

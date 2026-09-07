/** Reserved Recursive Language Model interface. Not wired in v1. */
export interface RlmEnvironment {
  loadPrompt(prompt: string): void;
  exec(code: string): Promise<{ stdout: string }>;
}

export function createUnimplementedRlm(): RlmEnvironment {
  return {
    loadPrompt() {
      throw new Error('RLM_NOT_IMPLEMENTED');
    },
    exec() {
      return Promise.reject(new Error('RLM_NOT_IMPLEMENTED'));
    },
  };
}

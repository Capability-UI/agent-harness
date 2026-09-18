export interface ResearchEvalTaskResult {
  crashed?: boolean;
}

export interface ResearchEvalMetric {
  total: number;
  tasks: ResearchEvalTaskResult[];
}

export interface ResearchEvalOutcome {
  code: number;
  message: string;
}

export function apiKeyPresent(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.OPENAI_API_KEY && env.OPENAI_API_KEY.trim());
}

/** Exit code and one-line operator error for `research/eval/run.mjs`. */
export function researchEvalOutcome(
  metric: ResearchEvalMetric,
  keyPresent = apiKeyPresent(),
): ResearchEvalOutcome {
  const crashed = metric.tasks.filter(task => task.crashed).length;
  if (!keyPresent) {
    return {
      code: 1,
      message: 'EVAL_NO_API_KEY: OPENAI_API_KEY is missing; solver tasks cannot run.',
    };
  }
  if (metric.total > 0 && crashed === metric.total) {
    return {
      code: 1,
      message: `EVAL_ALL_CRASHED: ${crashed}/${metric.total} tasks crashed.`,
    };
  }
  return { code: 0, message: '' };
}

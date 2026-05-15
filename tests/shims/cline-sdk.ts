export type AgentPlugin = {
  name: string;
  manifest: { capabilities: string[] };
  setup?: (api: { registerTool: (tool: unknown) => void }, ctx: unknown) => void | Promise<void>;
  hooks?: Record<string, (...args: unknown[]) => unknown>;
};

export type AgentToolContext = Record<string, unknown>;

export function createTool<TInput, TOutput>(config: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: TInput, context: AgentToolContext) => Promise<TOutput>;
  timeoutMs?: number;
  retryable?: boolean;
  maxRetries?: number;
}) {
  return config;
}

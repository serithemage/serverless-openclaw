import { createRequire } from "node:module";

// Cache the OpenClaw module across invocations (warm start optimization)
let cachedRunEmbeddedPiAgent: ((params: Record<string, unknown>) => Promise<unknown>) | null = null;

async function loadRunEmbeddedPiAgent(): Promise<(params: Record<string, unknown>) => Promise<unknown>> {
  if (cachedRunEmbeddedPiAgent) return cachedRunEmbeddedPiAgent;

  const req = createRequire(__filename);
  const mainPath = req.resolve("openclaw");
  const extensionApiPath = mainPath.replace(/index\.js$/, "extensionAPI.js");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import(`file://${extensionApiPath}`);
  cachedRunEmbeddedPiAgent = mod.runEmbeddedPiAgent;
  return cachedRunEmbeddedPiAgent!;
}

/**
 * Wrapper around OpenClaw's runEmbeddedPiAgent().
 *
 * Isolates the dynamic import so the rest of the codebase can be tested
 * without requiring the full OpenClaw package.
 */

interface RunAgentParams {
  sessionId: string;
  sessionFile: string;
  workspaceDir: string;
  message: string;
  model?: string;
  provider?: string;
  api?: string;
  disableTools?: boolean;
  channel: "web" | "telegram";
  onPartialReply?: (delta: string) => void;
}

interface AgentResult {
  payloads?: Array<{ text?: string; mediaUrl?: string; isError?: boolean }>;
  meta: {
    durationMs: number;
    agentMeta: {
      provider?: string;
      model?: string;
    };
    aborted?: boolean;
    error?: { kind: string; message: string };
  };
}

/**
 * Run the OpenClaw agent via dynamic import of extensionAPI.
 *
 * Uses dynamic import to:
 * 1. Avoid bundling OpenClaw at compile time
 * 2. Allow mocking in tests
 * 3. Defer the heavy import to runtime
 */
export async function runAgent(params: RunAgentParams): Promise<AgentResult> {
  const runEmbeddedPiAgent = await loadRunEmbeddedPiAgent();

  const callParams: Record<string, unknown> = {
    sessionId: params.sessionId,
    sessionFile: params.sessionFile,
    workspaceDir: params.workspaceDir,
    prompt: params.message,
    provider: params.provider ?? "anthropic",
    model: params.model ?? "claude-sonnet-4-20250514",
    disableTools: params.disableTools ?? false,
    messageChannel: params.channel === "telegram" ? "telegram" : "webchat",
    senderIsOwner: true,
    timeoutMs: 10 * 60 * 1000, // 10 minutes
    runId: `lambda-${params.sessionId}-${Date.now()}`,
    onPartialReply: params.onPartialReply
      ? (text: string) => params.onPartialReply!(text)
      : undefined,
  };

  if (params.api) {
    callParams.api = params.api;
  }

  const result = await runEmbeddedPiAgent(callParams);

  return result as AgentResult;
}

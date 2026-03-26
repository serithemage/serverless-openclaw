import type {
  LambdaAgentEvent,
  LambdaAgentResponse,
} from "./types.js";
import { resolveProviderConfig } from "@serverless-openclaw/shared";
import { initConfig } from "./config-init.js";
import { SessionSync } from "./session-sync.js";
import { SessionLock } from "./session-lock.js";
import { resolveSecrets } from "./secrets.js";
import { runAgent } from "./agent-runner.js";

// Resolved once at cold start
const providerConfig = resolveProviderConfig();

// Initialized once per Lambda cold start
let initialized = false;

/**
 * Lambda handler that runs OpenClaw's agent runtime directly.
 *
 * Flow:
 * 1. Resolve secrets from SSM (cached per instance)
 * 2. Initialize OpenClaw config in /tmp
 * 3. Download session file from S3
 * 4. Run agent via runEmbeddedPiAgent()
 * 5. Upload session file back to S3
 * 6. Return response
 */
export async function handler(
  event: LambdaAgentEvent,
): Promise<LambdaAgentResponse> {
  const startTime = Date.now();

  // Ensure HOME points to /tmp for OpenClaw config resolution
  process.env.HOME = "/tmp";

  const bucket = process.env.SESSION_BUCKET;
  if (!bucket) {
    return {
      success: false,
      error: "SESSION_BUCKET environment variable not set",
    };
  }

  const lock = new SessionLock(event.userId);
  const acquired = await lock.acquire();
  if (!acquired) {
    return {
      success: false,
      error: "Session is already being processed",
    };
  }

  // Cold start initialization
  if (!initialized) {
    let apiKey: string | undefined;

    // When using Anthropic, resolve the API key from SSM (existing behavior).
    // When using Bedrock, skip SSM — authentication is via IAM role credentials.
    if (providerConfig.provider === "anthropic") {
      const ssmKeyPath =
        process.env.SSM_ANTHROPIC_API_KEY ??
        "/serverless-openclaw/secrets/anthropic-api-key";

      const secrets = await resolveSecrets([ssmKeyPath]);
      apiKey = secrets.get(ssmKeyPath);
    }

    await initConfig({
      anthropicApiKey: apiKey,
      provider: providerConfig.provider,
      awsRegion: process.env.AWS_REGION,
    });
    initialized = true;
  }

  const sync = new SessionSync(bucket, "/tmp/.openclaw");
  const sessionFile = await sync.download(event.userId, event.sessionId);

  try {
    try {
      const result = await runAgent({
        sessionId: event.sessionId,
        sessionFile,
        workspaceDir: "/tmp/workspace",
        message: event.message,
        model: event.model ?? providerConfig.defaultModel,
        provider: providerConfig.openclawProvider,
        api: providerConfig.openclawApi,
        disableTools: event.disableTools,
        channel: event.channel,
      });

      // Always upload session after run (even if no payloads)
      await sync.upload(event.userId, event.sessionId);

      return {
        success: true,
        payloads: result.payloads,
        durationMs: Date.now() - startTime,
        provider: result.meta.agentMeta.provider,
        model: result.meta.agentMeta.model,
      };
    } catch (err: unknown) {
      // Upload session even on error (partial transcript may be valuable)
      await sync.upload(event.userId, event.sessionId);

      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startTime,
      };
    }
  } finally {
    await lock.release();
  }
}

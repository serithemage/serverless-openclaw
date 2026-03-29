import { PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  TABLE_NAMES,
  KEY_PREFIX,
  BRIDGE_PORT,
  BRIDGE_HTTP_TIMEOUT_MS,
  PENDING_MESSAGE_TTL_SEC,
  PREWARM_USER_ID,
} from "@serverless-openclaw/shared";
import type {
  BridgeMessageRequest,
  PendingMessageItem,
  TaskStateItem,
} from "@serverless-openclaw/shared";
import type { LambdaAgentResponse } from "@serverless-openclaw/shared";
import type { StartTaskParams } from "./container.js";
import type { InvokeLambdaAgentParams } from "./lambda-agent.js";
import { classifyRoute, stripRouteHint } from "./route-classifier.js";

type FetchFn = (
  url: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number; statusText: string }>;
type Send = (command: unknown) => Promise<unknown>;

export async function sendToBridge(
  fetchFn: FetchFn,
  publicIp: string,
  authToken: string,
  body: BridgeMessageRequest,
): Promise<void> {
  const resp = await fetchFn(`http://${publicIp}:${BRIDGE_PORT}/message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(BRIDGE_HTTP_TIMEOUT_MS),
  });

  if (!resp.ok) {
    throw new Error(`Bridge returned ${resp.status}`);
  }
}

export async function savePendingMessage(send: Send, item: PendingMessageItem): Promise<void> {
  await send(
    new PutCommand({
      TableName: TABLE_NAMES.PENDING_MESSAGES,
      Item: item,
    }),
  );
}

export interface RouteDeps {
  userId: string;
  message: string;
  channel: "web" | "telegram";
  connectionId: string;
  callbackUrl: string;
  bridgeAuthToken: string;
  fetchFn: FetchFn;
  getTaskState: (userId: string) => Promise<TaskStateItem | null>;
  startTask: (params: StartTaskParams) => Promise<string>;
  putTaskState: (item: TaskStateItem) => Promise<void>;
  savePendingMessage: (item: PendingMessageItem) => Promise<void>;
  deleteTaskState: (userId: string) => Promise<void>;
  startTaskParams: StartTaskParams;
  /** Lambda agent runtime support (Phase 2) */
  agentRuntime?: "lambda" | "fargate" | "both";
  invokeLambdaAgent?: (params: InvokeLambdaAgentParams) => Promise<LambdaAgentResponse>;
  lambdaAgentFunctionArn?: string;
  sessionId?: string;
  /** Called with agent payloads after a successful lambda invocation — caller is responsible for delivery */
  onLambdaResponse?: (payloads: LambdaAgentResponse["payloads"]) => Promise<void>;
  onColdStartPreview?: (previewText: string) => Promise<void>;
}

export type RouteResult = "sent" | "queued" | "started" | "lambda";

async function routeFargate(
  deps: RouteDeps,
  taskState: TaskStateItem | null,
): Promise<RouteResult> {
  if (taskState?.status === "Running" && taskState.publicIp) {
    try {
      await sendToBridge(deps.fetchFn, taskState.publicIp, deps.bridgeAuthToken, {
        userId: deps.userId,
        message: deps.message,
        channel: deps.channel,
        connectionId: deps.connectionId,
        callbackUrl: deps.callbackUrl,
      });
      return "sent";
    } catch (err) {
      console.warn(
        `Bridge unreachable at ${taskState.publicIp}, falling back to pending queue`,
        err,
      );
    }
  }

  // Try to claim a pre-warmed container
  if (!taskState) {
    const prewarm = await deps.getTaskState(PREWARM_USER_ID);
    if (prewarm?.status === "Running" && prewarm.publicIp) {
      try {
        await sendToBridge(deps.fetchFn, prewarm.publicIp, deps.bridgeAuthToken, {
          userId: deps.userId,
          message: deps.message,
          channel: deps.channel,
          connectionId: deps.connectionId,
          callbackUrl: deps.callbackUrl,
        });
        // Transfer ownership: delete prewarm, create user entry
        await deps.deleteTaskState(PREWARM_USER_ID);
        await deps.putTaskState({
          PK: `${KEY_PREFIX.USER}${deps.userId}`,
          taskArn: prewarm.taskArn,
          status: "Running",
          publicIp: prewarm.publicIp,
          startedAt: prewarm.startedAt,
          lastActivity: new Date().toISOString(),
        });
        return "sent";
      } catch {
        // Bridge unreachable — fall through to normal path
      }
    }
  }

  // Save to pending messages
  const now = Date.now();
  const uuid = `${now}-${Math.random().toString(36).slice(2, 8)}`;
  await deps.savePendingMessage({
    PK: `${KEY_PREFIX.USER}${deps.userId}`,
    SK: `${KEY_PREFIX.MSG}${now}#${uuid}`,
    message: deps.message,
    channel: deps.channel,
    connectionId: deps.connectionId,
    createdAt: new Date(now).toISOString(),
    ttl: Math.floor(now / 1000) + PENDING_MESSAGE_TTL_SEC,
  });

  // If no task or stale Running state, clear stale state and start a new one
  if (!taskState || (taskState.status === "Running" && taskState.publicIp)) {
    if (taskState) {
      await deps.deleteTaskState(deps.userId);
    }
    const taskArn = await deps.startTask(deps.startTaskParams);
    await deps.putTaskState({
      PK: `${KEY_PREFIX.USER}${deps.userId}`,
      taskArn,
      status: "Starting",
      startedAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    });
    return "started";
  }

  return "queued";
}

/**
 * Invoke Lambda with disableTools=true for a quick contextual preview
 * while Fargate container cold starts. Non-blocking (fire-and-forget).
 */
async function invokeColdStartPreview(deps: RouteDeps): Promise<void> {
  if (!deps.invokeLambdaAgent || !deps.lambdaAgentFunctionArn || !deps.onColdStartPreview) return;

  const response = await deps.invokeLambdaAgent({
    functionArn: deps.lambdaAgentFunctionArn,
    userId: deps.userId,
    sessionId: deps.sessionId ?? `session-${deps.userId}`,
    message: deps.message,
    channel: deps.channel,
    connectionId: deps.connectionId,
    disableTools: true,
  });

  if (response.success && response.payloads?.length) {
    const text = response.payloads
      .filter((p) => p.text && !p.isError)
      .map((p) => p.text)
      .join("\n");
    if (text) {
      await deps.onColdStartPreview(text);
    }
  }
}

export async function routeMessage(deps: RouteDeps): Promise<RouteResult> {
  // Phase 2: Lambda agent path
  if (deps.agentRuntime === "lambda" && deps.invokeLambdaAgent && deps.lambdaAgentFunctionArn) {
    const response = await deps.invokeLambdaAgent({
      functionArn: deps.lambdaAgentFunctionArn,
      userId: deps.userId,
      sessionId: deps.sessionId ?? `session-${deps.userId}`,
      message: deps.message,
      channel: deps.channel,
      connectionId: deps.connectionId,
    });
    if (!response.success) {
      throw new Error(response.error ?? "Lambda agent failed");
    }
    if (deps.onLambdaResponse) {
      await deps.onLambdaResponse(response.payloads);
    }
    return "lambda";
  }

  // Smart routing: when agentRuntime=both, classify based on task state and message hints
  if (deps.agentRuntime === "both" && deps.invokeLambdaAgent && deps.lambdaAgentFunctionArn) {
    const taskState = await deps.getTaskState(deps.userId);
    const decision = classifyRoute({ message: deps.message, taskState });

    if (decision === "fargate-reuse") {
      // Fall through to Fargate path below with the already-fetched taskState
      return routeFargate(deps, taskState);
    }

    if (decision === "fargate-new") {
      // Strip hint and queue to Fargate (new container)
      const strippedDeps = { ...deps, message: stripRouteHint(deps.message) };
      const result = await routeFargate(strippedDeps, taskState);

      // Cold start preview: invoke Lambda for quick context while Fargate starts
      if (
        (result === "started" || result === "queued") &&
        deps.onColdStartPreview !== undefined &&
        deps.invokeLambdaAgent !== undefined &&
        deps.lambdaAgentFunctionArn
      ) {
        invokeColdStartPreview(deps).catch((err) =>
          console.warn("Cold start preview failed (non-fatal):", err),
        );
      }

      return result;
    }

    // decision === "lambda": try Lambda, fall back to Fargate on failure
    const response = await deps.invokeLambdaAgent({
      functionArn: deps.lambdaAgentFunctionArn,
      userId: deps.userId,
      sessionId: deps.sessionId ?? `session-${deps.userId}`,
      message: deps.message,
      channel: deps.channel,
      connectionId: deps.connectionId,
    });
    if (response.success) {
      if (deps.onLambdaResponse) {
        await deps.onLambdaResponse(response.payloads);
      }
      return "lambda";
    }
    // Lambda failed — fall back to Fargate
    console.warn("Lambda agent failed, falling back to Fargate:", response.error);
    return routeFargate(deps, taskState);
  }

  // Fargate path (default)
  const taskState = await deps.getTaskState(deps.userId);
  return routeFargate(deps, taskState);
}

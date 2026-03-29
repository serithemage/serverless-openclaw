import type { APIGatewayProxyResultV2 } from "aws-lambda";
import { timingSafeEqual } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { ECSClient } from "@aws-sdk/client-ecs";

import { getTaskState, putTaskState, deleteTaskState } from "../services/task-state.js";
import { routeMessage, savePendingMessage } from "../services/message.js";
import { startTask } from "../services/container.js";
import { sendTelegramMessage } from "../services/telegram.js";
import { resolveUserId, verifyOtpAndLink } from "../services/identity.js";
import { resolveSecrets } from "../services/secrets.js";
import { invokeLambdaAgent } from "../services/lambda-agent.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ecs = new ECSClient({});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dynamoSend = ddb.send.bind(ddb) as (cmd: any) => Promise<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ecsSend = ecs.send.bind(ecs) as (cmd: any) => Promise<any>;

interface TelegramUpdate {
  message?: {
    chat: { id: number };
    from?: { id: number };
    text?: string;
  };
}

export async function handler(event: {
  headers: Record<string, string | undefined>;
  body?: string;
}): Promise<APIGatewayProxyResultV2> {
  const secrets = await resolveSecrets([
    process.env.SSM_BRIDGE_AUTH_TOKEN!,
    process.env.SSM_TELEGRAM_BOT_TOKEN!,
    process.env.SSM_TELEGRAM_SECRET_TOKEN!,
  ]);

  const secretToken = event.headers["x-telegram-bot-api-secret-token"];
  const expectedToken = secrets.get(process.env.SSM_TELEGRAM_SECRET_TOKEN!) ?? "";

  const tokenMatch =
    secretToken &&
    expectedToken &&
    secretToken.length === expectedToken.length &&
    timingSafeEqual(Buffer.from(secretToken), Buffer.from(expectedToken));
  if (!tokenMatch) {
    console.warn("[telegram] auth failed: secret token mismatch");
    return { statusCode: 403, body: JSON.stringify({ error: "Forbidden" }) };
  }

  if (!event.body) {
    console.log("[telegram] received empty body, ignoring");
    return { statusCode: 200, body: "OK" };
  }

  let update: TelegramUpdate;
  try {
    update = JSON.parse(event.body) as TelegramUpdate;
  } catch {
    console.error("[telegram] failed to parse request body as JSON");
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  if (!update.message?.text) {
    console.log("[telegram] update has no message text, ignoring");
    return { statusCode: 200, body: "OK" };
  }

  const chatId = update.message.chat.id;
  const telegramId = String(update.message.from?.id ?? chatId);
  const rawUserId = `telegram:${telegramId}`;
  const connectionId = `telegram:${chatId}`;
  const botToken = secrets.get(process.env.SSM_TELEGRAM_BOT_TOKEN!) ?? "";
  const text = update.message.text;

  console.log("[telegram] received message", { chatId, telegramId, textLength: text.length });

  // Handle /link command
  if (text.startsWith("/link ")) {
    const code = text.slice(6).trim();
    console.log("[telegram] /link command received", { telegramId });
    if (!/^\d{6}$/.test(code)) {
      console.warn("[telegram] /link invalid code format", { telegramId });
      if (botToken) {
        await sendTelegramMessage(
          fetch as never,
          botToken,
          connectionId,
          "Usage: /link {6-digit code}",
        );
      }
      return { statusCode: 200, body: "OK" };
    }
    const result = await verifyOtpAndLink(dynamoSend, telegramId, code, {
      agentRuntime: process.env.AGENT_RUNTIME,
    });
    console.log("[telegram] /link result", { telegramId, success: !("error" in result) });
    if (botToken) {
      const msg =
        "error" in result
          ? `❌ ${result.error}`
          : "✅ Account linked! Web and Telegram now share the same container.";
      await sendTelegramMessage(fetch as never, botToken, connectionId, msg);
    }
    return { statusCode: 200, body: "OK" };
  }

  // Handle /unlink command
  if (text === "/unlink") {
    console.log("[telegram] /unlink command received", { telegramId });
    if (botToken) {
      await sendTelegramMessage(
        fetch as never,
        botToken,
        connectionId,
        "Unlinking is only available from the Web UI settings.",
      );
    }
    return { statusCode: 200, body: "OK" };
  }

  // Resolve telegram userId to linked cognito userId if available
  const userId = await resolveUserId(dynamoSend, rawUserId);
  console.log("[telegram] resolved userId", { rawUserId, userId, linked: userId !== rawUserId });

  // Cold start reply — only relevant for Fargate (Lambda has no persistent task state)
  const agentRuntime = (process.env.AGENT_RUNTIME as "lambda" | "fargate" | "both") ?? "fargate";
  if (agentRuntime !== "lambda") {
    const taskState = await getTaskState(dynamoSend, userId);
    const needsColdStart = !taskState || taskState.status === "Starting";
    console.log("[telegram] fargate task state", {
      userId,
      taskStatus: taskState?.status ?? "none",
      needsColdStart,
    });

    if (needsColdStart && botToken) {
      await sendTelegramMessage(
        fetch as never,
        botToken,
        connectionId,
        "🔄 Waking up the agent... please wait.",
      );
    }
  }

  // Build environment for RunTask — include TELEGRAM_CHAT_ID when using resolved userId
  const taskEnv = [
    { name: "USER_ID", value: userId },
    { name: "CALLBACK_URL", value: process.env.WEBSOCKET_CALLBACK_URL ?? "" },
  ];
  if (userId !== rawUserId) {
    // Linked user: container needs to know the telegram chat ID for notifications
    taskEnv.push({ name: "TELEGRAM_CHAT_ID", value: String(chatId) });
  }

  console.log("[telegram] routing message", { userId, channel: "telegram", agentRuntime });
  const lambdaAgentFunctionArn = process.env.LAMBDA_AGENT_FUNCTION_ARN ?? "";
  await routeMessage({
    userId,
    message: text,
    channel: "telegram",
    connectionId,
    callbackUrl: process.env.WEBSOCKET_CALLBACK_URL ?? "",
    bridgeAuthToken: secrets.get(process.env.SSM_BRIDGE_AUTH_TOKEN!) ?? "",
    fetchFn: fetch as never,
    getTaskState: (uid) => getTaskState(dynamoSend, uid),
    startTask: (params) => startTask(ecsSend, params),
    putTaskState: (item) => putTaskState(dynamoSend, item),
    savePendingMessage: (item) => savePendingMessage(dynamoSend, item),
    deleteTaskState: (uid) => deleteTaskState(dynamoSend, uid),
    startTaskParams: {
      cluster: process.env.ECS_CLUSTER_ARN ?? "",
      taskDefinition: process.env.TASK_DEFINITION_ARN ?? "",
      subnets: (process.env.SUBNET_IDS ?? "").split(","),
      securityGroups: (process.env.SECURITY_GROUP_IDS ?? "").split(","),
      containerName: "openclaw",
      environment: taskEnv,
    },
    agentRuntime,
    invokeLambdaAgent: lambdaAgentFunctionArn ? invokeLambdaAgent : undefined,
    lambdaAgentFunctionArn: lambdaAgentFunctionArn || undefined,
    onLambdaResponse: async (payloads) => {
      for (const payload of payloads ?? []) {
        if (payload.text && botToken) {
          await sendTelegramMessage(fetch as never, botToken, connectionId, payload.text);
        }
      }
    },
    onColdStartPreview: botToken
      ? async (previewText) => {
          await sendTelegramMessage(fetch as never, botToken, connectionId, `💡 ${previewText}`);
        }
      : undefined,
  });

  console.log("[telegram] message routed successfully", { userId });
  return { statusCode: 200, body: "OK" };
}

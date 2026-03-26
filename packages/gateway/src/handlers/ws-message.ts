import type { APIGatewayProxyResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { ECSClient } from "@aws-sdk/client-ecs";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";

import type { ClientMessage, ServerMessage } from "@serverless-openclaw/shared";
import { getConnection } from "../services/connections.js";
import { getTaskState, putTaskState, deleteTaskState } from "../services/task-state.js";
import { routeMessage, savePendingMessage } from "../services/message.js";
import { startTask } from "../services/container.js";
import { resolveSecrets } from "../services/secrets.js";
import { invokeLambdaAgent } from "../services/lambda-agent.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ecs = new ECSClient({});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dynamoSend = ddb.send.bind(ddb) as (cmd: any) => Promise<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ecsSend = ecs.send.bind(ecs) as (cmd: any) => Promise<any>;

async function pushToConnection(connectionId: string, msg: ServerMessage): Promise<void> {
  const endpoint = process.env.WEBSOCKET_CALLBACK_URL ?? "";
  const apigw = new ApiGatewayManagementApiClient({ endpoint });
  try {
    await apigw.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify(msg),
      }),
    );
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "GoneException") return;
    throw err;
  }
}

export async function handler(event: {
  requestContext: { connectionId?: string };
  body?: string;
}): Promise<APIGatewayProxyResultV2> {
  const connectionId = event.requestContext.connectionId!;

  if (!event.body) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing body" }) };
  }

  let msg: ClientMessage;
  try {
    msg = JSON.parse(event.body) as ClientMessage;
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const connection = await getConnection(dynamoSend, connectionId);
  if (!connection) {
    return { statusCode: 403, body: JSON.stringify({ error: "Connection not found" }) };
  }

  const userId = connection.userId;

  if (msg.action === "getStatus") {
    const state = await getTaskState(dynamoSend, userId);
    const response: ServerMessage = {
      type: "status",
      status: state?.status ?? "idle",
    };
    return { statusCode: 200, body: JSON.stringify(response) };
  }

  if (msg.action === "sendMessage") {
    const agentRuntime = (process.env.AGENT_RUNTIME as "lambda" | "fargate" | "both") ?? "fargate";
    const secrets = await resolveSecrets([process.env.SSM_BRIDGE_AUTH_TOKEN!]);

    if (agentRuntime === "lambda" || agentRuntime === "both") {
      await pushToConnection(connectionId, { type: "status", status: "running" });
    }

    const result = await routeMessage({
      userId,
      message: msg.message ?? "",
      channel: "web",
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
        environment: [
          { name: "USER_ID", value: userId },
          { name: "CALLBACK_URL", value: process.env.WEBSOCKET_CALLBACK_URL ?? "" },
        ],
      },
      agentRuntime,
      invokeLambdaAgent,
      lambdaAgentFunctionArn: process.env.LAMBDA_AGENT_FUNCTION_ARN ?? "",
      onLambdaResponse: async (payloads) => {
        for (const payload of payloads ?? []) {
          if (payload.text) {
            await pushToConnection(connectionId, { type: "message", content: payload.text });
          }
        }
        await pushToConnection(connectionId, { type: "status", status: "Idle" });
      },
    });

    if (result === "started" || result === "queued") {
      await pushToConnection(connectionId, { type: "status", status: "Starting" });
    }

    return { statusCode: 200, body: JSON.stringify({ status: "processing" }) };
  }

  if (msg.action === "getHistory") {
    return { statusCode: 200, body: JSON.stringify({ type: "error", error: "Use REST API for history" }) };
  }

  return { statusCode: 400, body: JSON.stringify({ error: "Unknown action" }) };
}

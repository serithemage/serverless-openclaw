import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs";
import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import {
  TABLE_NAMES,
  KEY_PREFIX,
  PREWARM_USER_ID,
  DEFAULT_PREWARM_DURATION_MIN,
  METRICS_NAMESPACE,
} from "@serverless-openclaw/shared";
import type { TaskStateItem } from "@serverless-openclaw/shared";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ecs = new ECSClient({});
const cloudwatch = new CloudWatchClient({});

async function emitMetric(name: string, dimensions?: Array<{ Name: string; Value: string }>): Promise<void> {
  if (!process.env.METRICS_ENABLED) return;
  await cloudwatch.send(
    new PutMetricDataCommand({
      Namespace: METRICS_NAMESPACE,
      MetricData: [
        {
          MetricName: name,
          Value: 1,
          Unit: "Count",
          Timestamp: new Date(),
          ...(dimensions ? { Dimensions: dimensions } : {}),
        },
      ],
    }),
  );
}

export async function handler(): Promise<void> {
  const agentRuntime = process.env.AGENT_RUNTIME ?? "fargate";
  if (agentRuntime === "lambda") {
    console.log("[prewarm] AGENT_RUNTIME=lambda, skipping Fargate prewarm");
    return;
  }

  const durationMin = parseInt(process.env.PREWARM_DURATION || "", 10) || DEFAULT_PREWARM_DURATION_MIN;
  const prewarmUntil = Date.now() + durationMin * 60 * 1000;

  // Scan for any active tasks (Running or Starting)
  const result = (await ddb.send(
    new ScanCommand({
      TableName: TABLE_NAMES.TASK_STATE,
      FilterExpression: "#s IN (:running, :starting)",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":running": "Running", ":starting": "Starting" },
    }),
  )) as { Items?: TaskStateItem[] };

  const items = result.Items ?? [];

  if (items.length > 0) {
    // Extend prewarmUntil on the first active task
    const item = items[0];
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAMES.TASK_STATE,
        Key: { PK: item.PK },
        UpdateExpression: "SET lastActivity = :la, prewarmUntil = :pu",
        ExpressionAttributeValues: {
          ":la": new Date().toISOString(),
          ":pu": prewarmUntil,
        },
      }),
    );
    await emitMetric("PrewarmSkipped", [{ Name: "Reason", Value: "AlreadyRunning" }]);
    return;
  }

  // No active tasks — start a new pre-warmed container
  const taskResult = (await ecs.send(
    new RunTaskCommand({
      cluster: process.env.ECS_CLUSTER_ARN ?? "",
      taskDefinition: process.env.TASK_DEFINITION_ARN ?? "",
      capacityProviderStrategy: [
        { capacityProvider: "FARGATE_SPOT", weight: 1 },
      ],
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: (process.env.SUBNET_IDS ?? "").split(","),
          securityGroups: (process.env.SECURITY_GROUP_IDS ?? "").split(","),
          assignPublicIp: "ENABLED",
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: "openclaw",
            environment: [
              { name: "USER_ID", value: PREWARM_USER_ID },
              { name: "CALLBACK_URL", value: process.env.WEBSOCKET_CALLBACK_URL ?? "" },
            ],
          },
        ],
      },
    }),
  )) as { tasks?: Array<{ taskArn?: string }> };

  const taskArn = taskResult.tasks?.[0]?.taskArn;
  if (!taskArn) {
    console.error("Prewarm RunTask returned no tasks");
    return;
  }

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAMES.TASK_STATE,
      Item: {
        PK: `${KEY_PREFIX.USER}${PREWARM_USER_ID}`,
        taskArn,
        status: "Starting",
        startedAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        prewarmUntil,
      },
    }),
  );

  await emitMetric("PrewarmTriggered");
}

import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import type { Construct } from "constructs";
import { TABLE_NAMES } from "@serverless-openclaw/shared";

const NAMESPACE = "ServerlessOpenClaw";
const CHANNELS = ["web", "telegram"];

const LAMBDA_FUNCTIONS = [
  "serverless-openclaw-ws-connect",
  "serverless-openclaw-ws-disconnect",
  "serverless-openclaw-ws-message",
  "serverless-openclaw-telegram-webhook",
  "serverless-openclaw-api-handler",
  "serverless-openclaw-watchdog",
  "serverless-openclaw-prewarm",
];

const KEY_LAMBDA_FUNCTIONS = [
  "serverless-openclaw-ws-message",
  "serverless-openclaw-telegram-webhook",
];

/** Custom metric with Channel dimension — one per channel for correct CloudWatch lookup */
function channelMetrics(
  metricName: string,
  statistic: string,
  unit?: cloudwatch.Unit,
): cloudwatch.Metric[] {
  return CHANNELS.map(
    (ch) =>
      new cloudwatch.Metric({
        namespace: NAMESPACE,
        metricName,
        dimensionsMap: { Channel: ch },
        statistic,
        unit,
        period: cdk.Duration.minutes(5),
        label: `${metricName} (${ch})`,
      }),
  );
}

function lambdaMetric(
  functionName: string,
  metricName: string,
  statistic: string,
): cloudwatch.Metric {
  return new cloudwatch.Metric({
    namespace: "AWS/Lambda",
    metricName,
    dimensionsMap: { FunctionName: functionName },
    statistic,
    period: cdk.Duration.minutes(5),
    label: functionName.replace("serverless-openclaw-", ""),
  });
}

function sectionHeader(title: string, description: string): cloudwatch.TextWidget {
  return new cloudwatch.TextWidget({
    markdown: `### ${title}\n${description}`,
    width: 24,
    height: 1,
  });
}

export interface MonitoringStackProps extends cdk.StackProps {
  agentRuntime?: string;
}

export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: MonitoringStackProps) {
    super(scope, id, props);

    const fargateEnabled = (props?.agentRuntime ?? "fargate") !== "lambda";

    const dashboard = new cloudwatch.Dashboard(this, "Dashboard", {
      dashboardName: "ServerlessOpenClaw",
      periodOverride: cloudwatch.PeriodOverride.AUTO,
    });

    // ════════════════════════════════════════════════════════════════
    //  Section 1: Cold Start Performance (Fargate only)
    // ════════════════════════════════════════════════════════════════

    if (fargateEnabled) {
      dashboard.addWidgets(
        sectionHeader(
          "Cold Start Performance",
          "Fargate container startup time. Breakdown by phase: S3 restore → Gateway connection → Client ready.",
        ),
      );

      dashboard.addWidgets(
        new cloudwatch.SingleValueWidget({
          title: "Startup Total (p50)",
          metrics: channelMetrics("StartupTotal", "p50", cloudwatch.Unit.MILLISECONDS),
          width: 4,
          height: 4,
        }),
        new cloudwatch.GraphWidget({
          title: "Startup Total — p50 / p99",
          left: [
            ...channelMetrics("StartupTotal", "p50", cloudwatch.Unit.MILLISECONDS),
            ...channelMetrics("StartupTotal", "p99", cloudwatch.Unit.MILLISECONDS),
          ],
          width: 8,
          height: 4,
          leftYAxis: { label: "ms" },
        }),
        new cloudwatch.GraphWidget({
          title: "Startup Phase Breakdown (avg)",
          left: [
            ...channelMetrics("StartupS3Restore", "Average", cloudwatch.Unit.MILLISECONDS),
            ...channelMetrics("StartupGatewayWait", "Average", cloudwatch.Unit.MILLISECONDS),
            ...channelMetrics("StartupClientReady", "Average", cloudwatch.Unit.MILLISECONDS),
          ],
          width: 6,
          height: 4,
          stacked: true,
          leftYAxis: { label: "ms" },
        }),
        new cloudwatch.SingleValueWidget({
          title: "First Response (p50)",
          metrics: channelMetrics("FirstResponseTime", "p50", cloudwatch.Unit.MILLISECONDS),
          width: 6,
          height: 4,
        }),
      );
    }

    // ════════════════════════════════════════════════════════════════
    //  Section 2: Message Processing
    // ════════════════════════════════════════════════════════════════

    dashboard.addWidgets(
      sectionHeader(
        "Message Processing",
        "Latency and response length from user message to AI response. Pending message consumption during cold starts.",
      ),
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Message Latency — p50 / p99",
        left: [
          ...channelMetrics("MessageLatency", "p50", cloudwatch.Unit.MILLISECONDS),
          ...channelMetrics("MessageLatency", "p99", cloudwatch.Unit.MILLISECONDS),
        ],
        width: 8,
        height: 4,
        leftYAxis: { label: "ms" },
      }),
      new cloudwatch.GraphWidget({
        title: "Response Length (avg chars)",
        left: channelMetrics("ResponseLength", "Average", cloudwatch.Unit.COUNT),
        width: 4,
        height: 4,
        leftYAxis: { label: "chars" },
      }),
      new cloudwatch.SingleValueWidget({
        title: "Pending Consumed",
        metrics: channelMetrics("PendingMessagesConsumed", "Sum", cloudwatch.Unit.COUNT),
        width: 4,
        height: 4,
      }),
      new cloudwatch.GraphWidget({
        title: "Message Latency Trend",
        left: channelMetrics("MessageLatency", "Average", cloudwatch.Unit.MILLISECONDS),
        width: 8,
        height: 4,
        leftYAxis: { label: "ms" },
      }),
    );

    // ════════════════════════════════════════════════════════════════
    //  Section 3: Lambda Functions
    // ════════════════════════════════════════════════════════════════

    dashboard.addWidgets(
      sectionHeader(
        "Lambda Functions",
        "Gateway Lambda invocations, errors, and duration. ws-message and telegram-webhook are the key handlers.",
      ),
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Invocations",
        left: LAMBDA_FUNCTIONS.map((fn) =>
          lambdaMetric(fn, "Invocations", "Sum"),
        ),
        width: 8,
        height: 4,
      }),
      new cloudwatch.GraphWidget({
        title: "Errors",
        left: LAMBDA_FUNCTIONS.map((fn) =>
          lambdaMetric(fn, "Errors", "Sum"),
        ),
        width: 8,
        height: 4,
      }),
      new cloudwatch.GraphWidget({
        title: "Duration — p50 / p99 (key handlers)",
        left: KEY_LAMBDA_FUNCTIONS.flatMap((fn) => [
          lambdaMetric(fn, "Duration", "p50"),
          lambdaMetric(fn, "Duration", "p99"),
        ]),
        width: 8,
        height: 4,
        leftYAxis: { label: "ms" },
      }),
    );

    // ════════════════════════════════════════════════════════════════
    //  Section 4: API Gateway
    // ════════════════════════════════════════════════════════════════

    dashboard.addWidgets(
      sectionHeader(
        "API Gateway",
        "WebSocket connection count and HTTP API error rates. 4xx = client errors, 5xx = server errors.",
      ),
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "WebSocket Connections",
        left: [
          new cloudwatch.Metric({
            namespace: "AWS/ApiGateway",
            metricName: "ConnectCount",
            statistic: "Sum",
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 8,
        height: 4,
      }),
      new cloudwatch.GraphWidget({
        title: "HTTP API Errors — 4xx / 5xx",
        left: [
          new cloudwatch.Metric({
            namespace: "AWS/ApiGateway",
            metricName: "4xx",
            statistic: "Sum",
            period: cdk.Duration.minutes(5),
            label: "4xx (client)",
          }),
          new cloudwatch.Metric({
            namespace: "AWS/ApiGateway",
            metricName: "5xx",
            statistic: "Sum",
            period: cdk.Duration.minutes(5),
            label: "5xx (server)",
          }),
        ],
        width: 8,
        height: 4,
      }),
    );

    // ════════════════════════════════════════════════════════════════
    //  Section 5: Predictive Pre-Warming (Fargate only)
    // ════════════════════════════════════════════════════════════════

    if (fargateEnabled) {
      dashboard.addWidgets(
        sectionHeader(
          "Predictive Pre-Warming",
          "Pre-warm triggers and skips. Triggered = new container started proactively. Skipped = existing container reused.",
        ),
      );

      dashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: "Prewarm Events",
          left: [
            new cloudwatch.Metric({
              namespace: NAMESPACE,
              metricName: "PrewarmTriggered",
              statistic: "Sum",
              period: cdk.Duration.minutes(5),
              label: "Triggered",
            }),
            new cloudwatch.Metric({
              namespace: NAMESPACE,
              metricName: "PrewarmSkipped",
              statistic: "Sum",
              period: cdk.Duration.minutes(5),
              label: "Skipped",
            }),
          ],
          width: 12,
          height: 4,
        }),
        new cloudwatch.SingleValueWidget({
          title: "Prewarm Triggered (24h)",
          metrics: [
            new cloudwatch.Metric({
              namespace: NAMESPACE,
              metricName: "PrewarmTriggered",
              statistic: "Sum",
              period: cdk.Duration.hours(24),
              label: "Triggered",
            }),
          ],
          width: 6,
          height: 4,
        }),
        new cloudwatch.SingleValueWidget({
          title: "Prewarm Skipped (24h)",
          metrics: [
            new cloudwatch.Metric({
              namespace: NAMESPACE,
              metricName: "PrewarmSkipped",
              statistic: "Sum",
              period: cdk.Duration.hours(24),
              label: "Skipped",
            }),
          ],
          width: 6,
          height: 4,
        }),
      );
    }

    // ════════════════════════════════════════════════════════════════
    //  Section 6: Infrastructure — ECS & DynamoDB
    // ════════════════════════════════════════════════════════════════

    dashboard.addWidgets(
      sectionHeader(
        "Infrastructure — ECS & DynamoDB",
        "Fargate container resource usage and DynamoDB read/write consumption per table.",
      ),
    );

    if (fargateEnabled) {
      dashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: "Fargate CPU / Memory (%)",
          left: [
            new cloudwatch.Metric({
              namespace: "AWS/ECS",
              metricName: "CPUUtilization",
              dimensionsMap: { ClusterName: "serverless-openclaw" },
              statistic: "Average",
              period: cdk.Duration.minutes(5),
              label: "CPU",
            }),
            new cloudwatch.Metric({
              namespace: "AWS/ECS",
              metricName: "MemoryUtilization",
              dimensionsMap: { ClusterName: "serverless-openclaw" },
              statistic: "Average",
              period: cdk.Duration.minutes(5),
              label: "Memory",
            }),
          ],
          width: 8,
          height: 4,
          leftYAxis: { label: "%", max: 100 },
        }),
      );
    }

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "DynamoDB Read Capacity",
        left: Object.values(TABLE_NAMES).map(
          (tableName) =>
            new cloudwatch.Metric({
              namespace: "AWS/DynamoDB",
              metricName: "ConsumedReadCapacityUnits",
              dimensionsMap: { TableName: tableName },
              statistic: "Sum",
              period: cdk.Duration.minutes(5),
              label: tableName.replace("serverless-openclaw-", ""),
            }),
        ),
        width: 8,
        height: 4,
        leftYAxis: { label: "RCU" },
      }),
      new cloudwatch.GraphWidget({
        title: "DynamoDB Write Capacity",
        left: Object.values(TABLE_NAMES).map(
          (tableName) =>
            new cloudwatch.Metric({
              namespace: "AWS/DynamoDB",
              metricName: "ConsumedWriteCapacityUnits",
              dimensionsMap: { TableName: tableName },
              statistic: "Sum",
              period: cdk.Duration.minutes(5),
              label: tableName.replace("serverless-openclaw-", ""),
            }),
        ),
        width: 8,
        height: 4,
        leftYAxis: { label: "WCU" },
      }),
    );
  }
}

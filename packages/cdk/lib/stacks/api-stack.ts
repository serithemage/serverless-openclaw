import * as path from "path";
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import {
  WebSocketApi,
  WebSocketStage,
  HttpApi,
  HttpMethod,
  CorsHttpMethod,
} from "aws-cdk-lib/aws-apigatewayv2";
import {
  WebSocketLambdaIntegration,
  HttpLambdaIntegration,
} from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import { WATCHDOG_INTERVAL_MINUTES } from "@serverless-openclaw/shared";
import { SSM_PARAMS, SSM_SECRETS } from "./ssm-params.js";

export interface ApiStackProps extends cdk.StackProps {
  vpc?: ec2.IVpc;
  fargateSecurityGroup?: ec2.ISecurityGroup;
  conversationsTable: dynamodb.ITable;
  settingsTable: dynamodb.ITable;
  taskStateTable: dynamodb.ITable;
  connectionsTable: dynamodb.ITable;
  pendingMessagesTable: dynamodb.ITable;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  /** Agent runtime mode: 'fargate' | 'lambda' | 'both'. Default: 'fargate' */
  agentRuntime?: string;
}

export class ApiStack extends cdk.Stack {
  public readonly webSocketApi: WebSocketApi;
  public readonly webSocketStage: WebSocketStage;
  public readonly httpApi: HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const monorepoRoot = path.join(__dirname, "..", "..", "..", "..");
    const handlersDir = path.join(monorepoRoot, "packages", "gateway", "src", "handlers");

    // Common environment variables for Lambda functions
    const agentRuntime = props.agentRuntime ?? "fargate";
    const fargateEnabled = agentRuntime !== "lambda";

    let subnetIds = "";
    let securityGroupIds = "";
    if (fargateEnabled && props.vpc && props.fargateSecurityGroup) {
      subnetIds = props.vpc.publicSubnets.map((s) => s.subnetId).join(",");
      securityGroupIds = props.fargateSecurityGroup.securityGroupId;
    }

    // Read Fargate compute resources from SSM — only when ComputeStack is deployed
    const taskDefArn = fargateEnabled
      ? ssm.StringParameter.valueForStringParameter(this, SSM_PARAMS.TASK_DEFINITION_ARN)
      : "";
    const taskRoleArn = fargateEnabled
      ? ssm.StringParameter.valueForStringParameter(this, SSM_PARAMS.TASK_ROLE_ARN)
      : "";
    const executionRoleArn = fargateEnabled
      ? ssm.StringParameter.valueForStringParameter(this, SSM_PARAMS.EXECUTION_ROLE_ARN)
      : "";
    const clusterArn = fargateEnabled
      ? ssm.StringParameter.valueForStringParameter(this, SSM_PARAMS.CLUSTER_ARN)
      : "";
    const lambdaAgentEnabled = agentRuntime === "lambda" || agentRuntime === "both";
    const lambdaAgentFunctionArn = lambdaAgentEnabled
      ? ssm.StringParameter.valueForStringParameter(this, SSM_PARAMS.LAMBDA_AGENT_FUNCTION_ARN)
      : "";

    const commonEnv: Record<string, string> = {
      CONVERSATIONS_TABLE: props.conversationsTable.tableName,
      SETTINGS_TABLE: props.settingsTable.tableName,
      TASK_STATE_TABLE: props.taskStateTable.tableName,
      CONNECTIONS_TABLE: props.connectionsTable.tableName,
      PENDING_MESSAGES_TABLE: props.pendingMessagesTable.tableName,
      ...(fargateEnabled
        ? {
            ECS_CLUSTER_ARN: clusterArn,
            TASK_DEFINITION_ARN: taskDefArn,
            SUBNET_IDS: subnetIds,
            SECURITY_GROUP_IDS: securityGroupIds,
          }
        : {}),
      AGENT_RUNTIME: agentRuntime,
      LAMBDA_AGENT_FUNCTION_ARN: lambdaAgentFunctionArn,
    };

    // Common bundling options for NodejsFunction
    const bundlingDefaults = {
      externalModules: ["@aws-sdk/*"],
      sourceMap: true,
      target: "node22",
    };

    const nodejsFunctionDefaults = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      projectRoot: monorepoRoot,
      depsLockFilePath: path.join(monorepoRoot, "package-lock.json"),
      bundling: bundlingDefaults,
    };

    const makeLogGroup = (id: string, name: string) =>
      new logs.LogGroup(this, id, {
        logGroupName: `/aws/lambda/${name}`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

    // ── Lambda Functions ──

    const wsConnectFn = new NodejsFunction(this, "WsConnectFn", {
      ...nodejsFunctionDefaults,
      functionName: "serverless-openclaw-ws-connect",
      entry: path.join(handlersDir, "ws-connect.ts"),
      handler: "handler",
      logGroup: makeLogGroup("WsConnectLogGroup", "serverless-openclaw-ws-connect"),
      environment: {
        ...commonEnv,
        USER_POOL_ID: props.userPool.userPoolId,
        USER_POOL_CLIENT_ID: props.userPoolClient.userPoolClientId,
      },
    });

    const wsDisconnectFn = new NodejsFunction(this, "WsDisconnectFn", {
      ...nodejsFunctionDefaults,
      functionName: "serverless-openclaw-ws-disconnect",
      entry: path.join(handlersDir, "ws-disconnect.ts"),
      handler: "handler",
      logGroup: makeLogGroup("WsDisconnectLogGroup", "serverless-openclaw-ws-disconnect"),
      environment: { ...commonEnv },
    });

    const wsMessageFn = new NodejsFunction(this, "WsMessageFn", {
      ...nodejsFunctionDefaults,
      functionName: "serverless-openclaw-ws-message",
      entry: path.join(handlersDir, "ws-message.ts"),
      handler: "handler",
      logGroup: makeLogGroup("WsMessageLogGroup", "serverless-openclaw-ws-message"),
      environment: { ...commonEnv },
    });

    const telegramWebhookFn = new NodejsFunction(this, "TelegramWebhookFn", {
      ...nodejsFunctionDefaults,
      functionName: "serverless-openclaw-telegram-webhook",
      entry: path.join(handlersDir, "telegram-webhook.ts"),
      handler: "handler",
      logGroup: makeLogGroup("TelegramWebhookLogGroup", "serverless-openclaw-telegram-webhook"),
      environment: { ...commonEnv },
    });

    const apiHandlerFn = new NodejsFunction(this, "ApiHandlerFn", {
      ...nodejsFunctionDefaults,
      functionName: "serverless-openclaw-api-handler",
      entry: path.join(handlersDir, "api-handler.ts"),
      handler: "handler",
      logGroup: makeLogGroup("ApiHandlerLogGroup", "serverless-openclaw-api-handler"),
      environment: { ...commonEnv },
    });

    const watchdogFn = new NodejsFunction(this, "WatchdogFn", {
      ...nodejsFunctionDefaults,
      functionName: "serverless-openclaw-watchdog",
      entry: path.join(handlersDir, "watchdog.ts"),
      handler: "handler",
      logGroup: makeLogGroup("WatchdogLogGroup", "serverless-openclaw-watchdog"),
      environment: { ...commonEnv },
    });

    const prewarmFn = new NodejsFunction(this, "PrewarmFn", {
      ...nodejsFunctionDefaults,
      functionName: "serverless-openclaw-prewarm",
      entry: path.join(handlersDir, "prewarm.ts"),
      handler: "handler",
      logGroup: makeLogGroup("PrewarmLogGroup", "serverless-openclaw-prewarm"),
      environment: {
        ...commonEnv,
        PREWARM_DURATION: process.env.PREWARM_DURATION ?? "60",
        METRICS_ENABLED: "true",
      },
    });

    // Pass SSM parameter paths — Lambda resolves SecureString at runtime via SDK
    const secretFunctions = [wsMessageFn, telegramWebhookFn, watchdogFn];
    for (const fn of secretFunctions) {
      fn.addEnvironment("SSM_BRIDGE_AUTH_TOKEN", SSM_SECRETS.BRIDGE_AUTH_TOKEN);
    }
    telegramWebhookFn.addEnvironment(
      "SSM_TELEGRAM_SECRET_TOKEN",
      SSM_SECRETS.TELEGRAM_WEBHOOK_SECRET,
    );
    telegramWebhookFn.addEnvironment("SSM_TELEGRAM_BOT_TOKEN", SSM_SECRETS.TELEGRAM_BOT_TOKEN);

    // Grant SSM read access for secret resolution at runtime
    for (const fn of secretFunctions) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["ssm:GetParameters"],
          resources: Object.values(SSM_SECRETS).map(
            (p) => `arn:aws:ssm:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:parameter${p}`,
          ),
        }),
      );
    }

    // ── IAM Permissions for all Lambda functions ──

    const allFunctions = [
      wsConnectFn,
      wsDisconnectFn,
      wsMessageFn,
      telegramWebhookFn,
      apiHandlerFn,
      watchdogFn,
      prewarmFn,
    ];

    const tables = [
      props.conversationsTable,
      props.settingsTable,
      props.taskStateTable,
      props.connectionsTable,
      props.pendingMessagesTable,
    ];

    for (const fn of allFunctions) {
      for (const table of tables) {
        table.grantReadWriteData(fn);
      }
    }

    // ECS + EC2 permissions for functions that need container management (Fargate only)
    if (fargateEnabled) {
      const containerFunctions = [wsMessageFn, telegramWebhookFn, watchdogFn, prewarmFn];
      for (const fn of containerFunctions) {
        fn.addToRolePolicy(
          new iam.PolicyStatement({
            actions: ["ecs:RunTask", "ecs:StopTask", "ecs:DescribeTasks"],
            resources: ["*"],
          }),
        );
        fn.addToRolePolicy(
          new iam.PolicyStatement({
            actions: ["ec2:DescribeNetworkInterfaces"],
            resources: ["*"],
          }),
        );
        fn.addToRolePolicy(
          new iam.PolicyStatement({
            actions: ["iam:PassRole"],
            resources: [taskRoleArn, executionRoleArn],
          }),
        );
      }
    }

    // Lambda agent invoke permission (Phase 2)
    if (lambdaAgentEnabled) {
      const agentInvokeFunctions = [wsMessageFn, telegramWebhookFn];
      for (const fn of agentInvokeFunctions) {
        fn.addToRolePolicy(
          new iam.PolicyStatement({
            actions: ["lambda:InvokeFunction"],
            resources: [lambdaAgentFunctionArn],
          }),
        );
      }
    }

    // CloudWatch read access for watchdog dynamic timeout
    watchdogFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cloudwatch:GetMetricStatistics"],
        resources: ["*"],
      }),
    );

    // CloudWatch write access for prewarm metrics
    prewarmFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cloudwatch:PutMetricData"],
        resources: ["*"],
      }),
    );

    // ── WebSocket API ──

    this.webSocketApi = new WebSocketApi(this, "WebSocketApi", {
      apiName: "serverless-openclaw-ws",
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration("WsConnectInteg", wsConnectFn),
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration("WsDisconnectInteg", wsDisconnectFn),
      },
      defaultRouteOptions: {
        integration: new WebSocketLambdaIntegration("WsMessageInteg", wsMessageFn),
      },
    });

    this.webSocketStage = new WebSocketStage(this, "WebSocketStage", {
      webSocketApi: this.webSocketApi,
      stageName: "prod",
      autoDeploy: true,
    });

    // WebSocket callback URL for @connections
    const callbackUrl = this.webSocketStage.callbackUrl;
    for (const fn of [wsMessageFn, telegramWebhookFn, watchdogFn]) {
      fn.addEnvironment("WEBSOCKET_CALLBACK_URL", callbackUrl);
    }

    // Grant execute-api:ManageConnections for WebSocket push
    const wsCallbackFunctions = [wsMessageFn, telegramWebhookFn, watchdogFn, prewarmFn];
    for (const fn of wsCallbackFunctions) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["execute-api:ManageConnections"],
          resources: [
            `arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.apiId}/*`,
          ],
        }),
      );
    }

    // ── HTTP API (REST) ──

    const jwtIssuer = `https://cognito-idp.${this.region}.amazonaws.com/${props.userPool.userPoolId}`;
    const jwtAuthorizer = new HttpJwtAuthorizer("CognitoAuthorizer", jwtIssuer, {
      jwtAudience: [props.userPoolClient.userPoolClientId],
    });

    this.httpApi = new HttpApi(this, "HttpApi", {
      apiName: "serverless-openclaw-http",
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
        allowHeaders: ["Authorization", "Content-Type"],
      },
    });

    // POST /telegram — no authorizer (Telegram secret token verified in Lambda)
    this.httpApi.addRoutes({
      path: "/telegram",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration("TelegramInteg", telegramWebhookFn),
    });

    // GET /conversations — Cognito JWT
    this.httpApi.addRoutes({
      path: "/conversations",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("ConversationsInteg", apiHandlerFn),
      authorizer: jwtAuthorizer,
    });

    // GET /status — Cognito JWT
    this.httpApi.addRoutes({
      path: "/status",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("StatusInteg", apiHandlerFn),
      authorizer: jwtAuthorizer,
    });

    // POST /link/generate-otp — Cognito JWT
    this.httpApi.addRoutes({
      path: "/link/generate-otp",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration("LinkGenerateOtpInteg", apiHandlerFn),
      authorizer: jwtAuthorizer,
    });

    // GET /link/status — Cognito JWT
    this.httpApi.addRoutes({
      path: "/link/status",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("LinkStatusInteg", apiHandlerFn),
      authorizer: jwtAuthorizer,
    });

    // POST /link/unlink — Cognito JWT
    this.httpApi.addRoutes({
      path: "/link/unlink",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration("LinkUnlinkInteg", apiHandlerFn),
      authorizer: jwtAuthorizer,
    });

    // ── EventBridge Rule — Watchdog ──

    new events.Rule(this, "WatchdogRule", {
      ruleName: "serverless-openclaw-watchdog",
      schedule: events.Schedule.rate(cdk.Duration.minutes(WATCHDOG_INTERVAL_MINUTES)),
      targets: [new targets.LambdaFunction(watchdogFn)],
    });

    // ── EventBridge Rules — Prewarm (conditional) ──

    const prewarmSchedule = process.env.PREWARM_SCHEDULE ?? "";
    if (prewarmSchedule) {
      const crons = prewarmSchedule.split(",").map((s) => s.trim());
      crons.forEach((cron, i) => {
        new events.Rule(this, `PrewarmRule${i}`, {
          ruleName: `serverless-openclaw-prewarm-${i}`,
          schedule: events.Schedule.expression(`cron(${cron})`),
          targets: [new targets.LambdaFunction(prewarmFn)],
        });
      });
    }

    // ── Outputs ──

    new cdk.CfnOutput(this, "WebSocketApiEndpoint", {
      value: this.webSocketStage.url,
    });
    new cdk.CfnOutput(this, "HttpApiEndpoint", {
      value: this.httpApi.apiEndpoint,
    });
    new cdk.CfnOutput(this, "WebSocketCallbackUrl", {
      value: callbackUrl,
    });
  }
}

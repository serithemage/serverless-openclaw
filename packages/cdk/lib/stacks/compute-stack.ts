import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { BRIDGE_PORT, TABLE_NAMES } from "@serverless-openclaw/shared";
import { SSM_PARAMS, SSM_SECRETS } from "./ssm-params.js";

export interface ComputeStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  fargateSecurityGroup: ec2.ISecurityGroup;
  conversationsTable: dynamodb.ITable;
  settingsTable: dynamodb.ITable;
  taskStateTable: dynamodb.ITable;
  connectionsTable: dynamodb.ITable;
  pendingMessagesTable: dynamodb.ITable;
  dataBucket: s3.IBucket;
  ecrRepository: ecr.IRepository;
  /** Fargate CPU units (256, 512, 1024, 2048, 4096). Default: 1024 */
  fargateCpu?: number;
  /** Fargate memory in MiB. Must be compatible with CPU. Default: 2048 */
  fargateMemory?: number;
  aiProvider?: string;
  aiModel?: string;
}

export class ComputeStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly taskDefinition: ecs.FargateTaskDefinition;
  public readonly taskRole: iam.IRole;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    // SSM SecureString parameter references (manually created)
    const bridgeAuthToken = ssm.StringParameter.fromSecureStringParameterAttributes(
      this, "BridgeAuthToken",
      { parameterName: SSM_SECRETS.BRIDGE_AUTH_TOKEN },
    );
    const openclawGatewayToken = ssm.StringParameter.fromSecureStringParameterAttributes(
      this, "OpenclawGatewayToken",
      { parameterName: SSM_SECRETS.OPENCLAW_GATEWAY_TOKEN },
    );
    const anthropicApiKey = props.aiProvider !== "bedrock"
      ? ssm.StringParameter.fromSecureStringParameterAttributes(
          this, "AnthropicApiKey",
          { parameterName: SSM_SECRETS.ANTHROPIC_API_KEY },
        )
      : undefined;
    const telegramBotToken = ssm.StringParameter.fromSecureStringParameterAttributes(
      this, "TelegramBotToken",
      { parameterName: SSM_SECRETS.TELEGRAM_BOT_TOKEN },
    );

    // ECS Cluster — FARGATE_SPOT only
    this.cluster = new ecs.Cluster(this, "Cluster", {
      clusterName: "serverless-openclaw",
      vpc: props.vpc,
      enableFargateCapacityProviders: true,
    });

    // Fargate Task Definition — ARM64
    this.taskDefinition = new ecs.FargateTaskDefinition(this, "TaskDef", {
      memoryLimitMiB: props.fargateMemory ?? 2048,
      cpu: props.fargateCpu ?? 1024,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    this.taskRole = this.taskDefinition.taskRole;

    // Container
    const logGroup = new logs.LogGroup(this, "TaskLogs", {
      logGroupName: "/ecs/serverless-openclaw",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.taskDefinition.addContainer("openclaw", {
      image: ecs.ContainerImage.fromEcrRepository(props.ecrRepository, "latest"),
      portMappings: [{ containerPort: BRIDGE_PORT }],
      environment: {
        CONVERSATIONS_TABLE: TABLE_NAMES.CONVERSATIONS,
        SETTINGS_TABLE: TABLE_NAMES.SETTINGS,
        TASK_STATE_TABLE: TABLE_NAMES.TASK_STATE,
        CONNECTIONS_TABLE: TABLE_NAMES.CONNECTIONS,
        PENDING_MESSAGES_TABLE: TABLE_NAMES.PENDING_MESSAGES,
        DATA_BUCKET: props.dataBucket.bucketName,
        BRIDGE_PORT: String(BRIDGE_PORT),
        METRICS_ENABLED: "true",
        AI_PROVIDER: props.aiProvider ?? "anthropic",
        ...(props.aiModel ? { AI_MODEL: props.aiModel } : {}),
        AWS_REGION: this.region,
      },
      secrets: {
        BRIDGE_AUTH_TOKEN: ecs.Secret.fromSsmParameter(bridgeAuthToken),
        OPENCLAW_GATEWAY_TOKEN: ecs.Secret.fromSsmParameter(openclawGatewayToken),
        ...(anthropicApiKey ? { ANTHROPIC_API_KEY: ecs.Secret.fromSsmParameter(anthropicApiKey) } : {}),
        TELEGRAM_BOT_TOKEN: ecs.Secret.fromSsmParameter(telegramBotToken),
      },
      logging: ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: "openclaw",
      }),
      healthCheck: {
        command: ["CMD-SHELL", `curl -f http://localhost:${BRIDGE_PORT}/health || exit 1`],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(120),
      },
    });

    // IAM — Task Role permissions
    const tables = [
      props.conversationsTable,
      props.settingsTable,
      props.taskStateTable,
      props.connectionsTable,
      props.pendingMessagesTable,
    ];
    for (const table of tables) {
      table.grantReadWriteData(this.taskRole);
    }
    props.dataBucket.grantReadWrite(this.taskRole);

    // CloudWatch metrics publishing
    this.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["cloudwatch:PutMetricData"],
        resources: ["*"],
      }),
    );

    // ECS + EC2 permissions for public IP self-discovery
    this.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["ecs:DescribeTasks"],
        resources: ["*"],
      }),
    );
    this.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["ec2:DescribeNetworkInterfaces"],
        resources: ["*"],
      }),
    );

    // API Gateway @connections for pushing messages back to WebSocket clients
    this.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["execute-api:ManageConnections"],
        resources: ["*"],
      }),
    );

    // IAM — Bedrock (always provisioned; IAM policies cost nothing)
    this.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:ListFoundationModels",
        ],
        resources: ["*"],
      }),
    );

    // SSM Parameters for cross-stack decoupling
    new ssm.StringParameter(this, "TaskDefArnParam", {
      parameterName: SSM_PARAMS.TASK_DEFINITION_ARN,
      stringValue: this.taskDefinition.taskDefinitionArn,
    });
    new ssm.StringParameter(this, "TaskRoleArnParam", {
      parameterName: SSM_PARAMS.TASK_ROLE_ARN,
      stringValue: this.taskRole.roleArn,
    });
    new ssm.StringParameter(this, "ExecutionRoleArnParam", {
      parameterName: SSM_PARAMS.EXECUTION_ROLE_ARN,
      stringValue: this.taskDefinition.executionRole!.roleArn,
    });
    new ssm.StringParameter(this, "ClusterArnParam", {
      parameterName: SSM_PARAMS.CLUSTER_ARN,
      stringValue: this.cluster.clusterArn,
    });

    // Outputs
    new cdk.CfnOutput(this, "ClusterArn", { value: this.cluster.clusterArn });
    new cdk.CfnOutput(this, "TaskDefinitionArn", {
      value: this.taskDefinition.taskDefinitionArn,
    });
  }
}

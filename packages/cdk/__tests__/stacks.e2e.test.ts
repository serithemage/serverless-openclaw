import { describe, it, expect, beforeAll } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import {
  NetworkStack,
  StorageStack,
  AuthStack,
  ComputeStack,
  ApiStack,
  WebStack,
  MonitoringStack,
  SecretsStack,
  LambdaAgentStack,
} from "../lib/stacks/index.js";

describe("CDK Stacks E2E — synth all stacks", () => {
  let app: cdk.App;
  let networkTemplate: Template;
  let storageTemplate: Template;
  let authTemplate: Template;
  let computeTemplate: Template;
  let apiTemplate: Template;
  let webTemplate: Template;
  let monitoringTemplate: Template;
  let secretsTemplate: Template;
  let lambdaAgentTemplate: Template;

  beforeAll(() => {
    app = new cdk.App();

    // Secrets
    const secrets = new SecretsStack(app, "TestSecretsStack");

    // Step 1-2: Network & Storage
    const network = new NetworkStack(app, "TestNetworkStack");
    const storage = new StorageStack(app, "TestStorageStack");

    // Step 1-6: Auth
    const auth = new AuthStack(app, "TestAuthStack");

    // Step 1-7: Compute
    const compute = new ComputeStack(app, "TestComputeStack", {
      vpc: network.vpc,
      fargateSecurityGroup: network.fargateSecurityGroup,
      conversationsTable: storage.conversationsTable,
      settingsTable: storage.settingsTable,
      taskStateTable: storage.taskStateTable,
      connectionsTable: storage.connectionsTable,
      pendingMessagesTable: storage.pendingMessagesTable,
      dataBucket: storage.dataBucket,
      ecrRepository: storage.ecrRepository,
    });

    // Phase 2: Lambda Agent
    const lambdaAgent = new LambdaAgentStack(app, "TestLambdaAgentStack", {
      dataBucket: storage.dataBucket,
      taskStateTable: storage.taskStateTable,
    });

    // Step 1-5: API Gateway + Lambda
    const api = new ApiStack(app, "TestApiStack", {
      vpc: network.vpc,
      fargateSecurityGroup: network.fargateSecurityGroup,
      conversationsTable: storage.conversationsTable,
      settingsTable: storage.settingsTable,
      taskStateTable: storage.taskStateTable,
      connectionsTable: storage.connectionsTable,
      pendingMessagesTable: storage.pendingMessagesTable,
      userPool: auth.userPool,
      userPoolClient: auth.userPoolClient,
      cluster: compute.cluster,
      taskDefinition: compute.taskDefinition,
    });

    // Step 1-8: Web UI
    new WebStack(app, "TestWebStack", {
      webSocketUrl: "wss://test.execute-api.us-east-1.amazonaws.com/prod",
      apiUrl: "https://test.execute-api.us-east-1.amazonaws.com",
      userPoolId: "us-east-1_test",
      userPoolClientId: "testclientid",
    });

    // Monitoring Dashboard
    const monitoring = new MonitoringStack(app, "TestMonitoringStack");

    secretsTemplate = Template.fromStack(secrets);
    networkTemplate = Template.fromStack(network);
    storageTemplate = Template.fromStack(storage);
    authTemplate = Template.fromStack(auth);
    computeTemplate = Template.fromStack(compute);
    apiTemplate = Template.fromStack(api);
    webTemplate = Template.fromStack(app.node.findChild("TestWebStack") as cdk.Stack);
    monitoringTemplate = Template.fromStack(monitoring);
    lambdaAgentTemplate = Template.fromStack(lambdaAgent);
  });

  // ── SecretsStack ──

  describe("SecretsStack", () => {
    it("5 SSM SecureString parameters via Custom Resources", () => {
      secretsTemplate.resourceCountIs("Custom::AWS", 5);
    });
  });

  // ── NetworkStack ──

  describe("NetworkStack", () => {
    it("VPC with natGateways: 0", () => {
      networkTemplate.resourceCountIs("AWS::EC2::VPC", 1);
      networkTemplate.resourceCountIs("AWS::EC2::NatGateway", 0);
    });

    it("Public subnets in 2 AZs", () => {
      networkTemplate.resourceCountIs("AWS::EC2::Subnet", 2);
    });

    it("VPC Gateway Endpoints (DynamoDB + S3)", () => {
      networkTemplate.resourceCountIs("AWS::EC2::VPCEndpoint", 2);
    });

    it("Fargate Security Group", () => {
      networkTemplate.resourceCountIs("AWS::EC2::SecurityGroup", 1);
    });
  });

  // ── StorageStack ──

  describe("StorageStack", () => {
    it("5 DynamoDB tables", () => {
      storageTemplate.resourceCountIs("AWS::DynamoDB::Table", 5);
    });

    it("all tables use PAY_PER_REQUEST", () => {
      const tables = storageTemplate.findResources("AWS::DynamoDB::Table");
      for (const [, table] of Object.entries(tables)) {
        expect((table as Record<string, unknown>).Properties).toHaveProperty(
          "BillingMode",
          "PAY_PER_REQUEST",
        );
      }
    });

    it("Connections table has userId-index GSI", () => {
      storageTemplate.hasResourceProperties("AWS::DynamoDB::Table", {
        TableName: "serverless-openclaw-Connections",
        GlobalSecondaryIndexes: [
          {
            IndexName: "userId-index",
          },
        ],
      });
    });

    it("S3 data bucket with BlockPublicAccess", () => {
      storageTemplate.resourceCountIs("AWS::S3::Bucket", 1);
      storageTemplate.hasResourceProperties("AWS::S3::Bucket", {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      });
    });

    it("ECR repository", () => {
      storageTemplate.resourceCountIs("AWS::ECR::Repository", 1);
    });
  });

  // ── AuthStack ──

  describe("AuthStack", () => {
    it("Cognito User Pool", () => {
      authTemplate.resourceCountIs("AWS::Cognito::UserPool", 1);
    });

    it("User Pool Client with SRP auth", () => {
      authTemplate.hasResourceProperties("AWS::Cognito::UserPoolClient", {
        ExplicitAuthFlows: ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
      });
    });

    it("User Pool Domain", () => {
      authTemplate.resourceCountIs("AWS::Cognito::UserPoolDomain", 1);
    });
  });

  // ── ComputeStack ──

  describe("ComputeStack", () => {
    it("ECS Cluster", () => {
      computeTemplate.resourceCountIs("AWS::ECS::Cluster", 1);
    });

    it("Fargate Task Definition with ARM64", () => {
      computeTemplate.hasResourceProperties("AWS::ECS::TaskDefinition", {
        RuntimePlatform: {
          CpuArchitecture: "ARM64",
          OperatingSystemFamily: "LINUX",
        },
        Cpu: "1024",
        Memory: "2048",
      });
    });

    it("CloudWatch Log Group", () => {
      computeTemplate.resourceCountIs("AWS::Logs::LogGroup", 1);
    });
  });

  // ── ApiStack ──

  describe("ApiStack", () => {
    it("7 Lambda functions", () => {
      const functions = apiTemplate.findResources("AWS::Lambda::Function");
      expect(Object.keys(functions).length).toBe(7);
    });

    it("7 CloudWatch log groups with ONE_WEEK retention", () => {
      const logGroups = apiTemplate.findResources("AWS::Logs::LogGroup");
      expect(Object.keys(logGroups).length).toBe(7);
      for (const [, lg] of Object.entries(logGroups)) {
        const props = (lg as Record<string, unknown>).Properties as Record<string, unknown>;
        expect(props).toHaveProperty("RetentionInDays", 7);
      }
    });

    it("WebSocket API", () => {
      apiTemplate.resourceCountIs("AWS::ApiGatewayV2::Api", 2); // WS + HTTP
    });

    it("WebSocket stage (prod)", () => {
      apiTemplate.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
        StageName: "prod",
        AutoDeploy: true,
      });
    });

    it("EventBridge watchdog rule (no prewarm schedule set)", () => {
      // Without PREWARM_SCHEDULE env var, only watchdog rule exists
      apiTemplate.resourceCountIs("AWS::Events::Rule", 1);
    });

    it("Handler Lambda functions use ARM64", () => {
      const functions = apiTemplate.findResources("AWS::Lambda::Function");
      for (const [, fn] of Object.entries(functions)) {
        const props = (fn as Record<string, unknown>).Properties as Record<string, unknown>;
        expect(props).toHaveProperty("Architectures", ["arm64"]);
      }
    });
  });

  // ── WebStack ──

  describe("WebStack", () => {
    it("S3 bucket for web assets", () => {
      webTemplate.resourceCountIs("AWS::S3::Bucket", 1);
    });

    it("CloudFront distribution", () => {
      webTemplate.resourceCountIs("AWS::CloudFront::Distribution", 1);
    });

    it("CloudFront OAC", () => {
      webTemplate.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
    });

    it("SPA error responses (403, 404 → index.html)", () => {
      webTemplate.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: {
          CustomErrorResponses: [
            {
              ErrorCode: 403,
              ResponseCode: 200,
              ResponsePagePath: "/index.html",
            },
            {
              ErrorCode: 404,
              ResponseCode: 200,
              ResponsePagePath: "/index.html",
            },
          ],
        },
      });
    });
  });

  // ── LambdaAgentStack ──

  describe("LambdaAgentStack", () => {
    it("Lambda DockerImageFunction", () => {
      lambdaAgentTemplate.resourceCountIs("AWS::Lambda::Function", 1);
    });

    it("Lambda with ARM64, 2048MB, 15min timeout", () => {
      lambdaAgentTemplate.hasResourceProperties("AWS::Lambda::Function", {
        Architectures: ["arm64"],
        MemorySize: 2048,
        Timeout: 900,
        EphemeralStorage: { Size: 2048 },
      });
    });

    it("Lambda has HOME=/tmp and SESSION_BUCKET env vars", () => {
      const functions = lambdaAgentTemplate.findResources("AWS::Lambda::Function");
      const fn = Object.values(functions)[0] as Record<string, unknown>;
      const env = ((fn.Properties as Record<string, unknown>).Environment as Record<string, unknown>).Variables as Record<string, unknown>;
      expect(env.HOME).toBe("/tmp");
      expect(env.SSM_ANTHROPIC_API_KEY).toBe("/serverless-openclaw/secrets/anthropic-api-key");
      expect(env.SESSION_BUCKET).toBeDefined();
    });

    it("no ECR repository (imported externally via fromRepositoryName)", () => {
      lambdaAgentTemplate.resourceCountIs("AWS::ECR::Repository", 0);
    });

    it("SSM parameter for Lambda function ARN", () => {
      lambdaAgentTemplate.hasResourceProperties("AWS::SSM::Parameter", {
        Name: "/serverless-openclaw/lambda-agent/function-arn",
      });
    });

    it("no NAT Gateway", () => {
      lambdaAgentTemplate.resourceCountIs("AWS::EC2::NatGateway", 0);
    });

    it("Log group", () => {
      lambdaAgentTemplate.resourceCountIs("AWS::Logs::LogGroup", 1);
    });
  });

  // ── MonitoringStack ──

  describe("MonitoringStack", () => {
    it("CloudWatch Dashboard", () => {
      monitoringTemplate.resourceCountIs("AWS::CloudWatch::Dashboard", 1);
    });

    it("Dashboard named ServerlessOpenClaw", () => {
      monitoringTemplate.hasResourceProperties("AWS::CloudWatch::Dashboard", {
        DashboardName: "ServerlessOpenClaw",
      });
    });
  });
});

describe("ApiStack with PREWARM_SCHEDULE", () => {
  it("should create EventBridge rules for each cron expression", () => {
    const originalSchedule = process.env.PREWARM_SCHEDULE;
    process.env.PREWARM_SCHEDULE = "0 9 ? * MON-FRI *,0 14 ? * SAT-SUN *";

    try {
      const app = new cdk.App();
      const network = new NetworkStack(app, "PrewarmNetworkStack");
      const storage = new StorageStack(app, "PrewarmStorageStack");
      const auth = new AuthStack(app, "PrewarmAuthStack");
      const compute = new ComputeStack(app, "PrewarmComputeStack", {
        vpc: network.vpc,
        fargateSecurityGroup: network.fargateSecurityGroup,
        conversationsTable: storage.conversationsTable,
        settingsTable: storage.settingsTable,
        taskStateTable: storage.taskStateTable,
        connectionsTable: storage.connectionsTable,
        pendingMessagesTable: storage.pendingMessagesTable,
        dataBucket: storage.dataBucket,
        ecrRepository: storage.ecrRepository,
      });
      const api = new ApiStack(app, "PrewarmApiStack", {
        vpc: network.vpc,
        fargateSecurityGroup: network.fargateSecurityGroup,
        conversationsTable: storage.conversationsTable,
        settingsTable: storage.settingsTable,
        taskStateTable: storage.taskStateTable,
        connectionsTable: storage.connectionsTable,
        pendingMessagesTable: storage.pendingMessagesTable,
        userPool: auth.userPool,
        userPoolClient: auth.userPoolClient,
        agentRuntime: "fargate",
      });

      const template = Template.fromStack(api);
      // 1 watchdog + 2 prewarm = 3 rules
      template.resourceCountIs("AWS::Events::Rule", 3);
    } finally {
      if (originalSchedule === undefined) {
        delete process.env.PREWARM_SCHEDULE;
      } else {
        process.env.PREWARM_SCHEDULE = originalSchedule;
      }
    }
  });
});

describe("ApiStack with AGENT_RUNTIME=lambda", () => {
  it("does not contain Fargate SSM dynamic references", () => {
    const app = new cdk.App();
    const network = new NetworkStack(app, "LambdaModeNetworkStack");
    const storage = new StorageStack(app, "LambdaModeStorageStack");
    const auth = new AuthStack(app, "LambdaModeAuthStack");
    const api = new ApiStack(app, "LambdaModeApiStack", {
      vpc: network.vpc,
      fargateSecurityGroup: network.fargateSecurityGroup,
      conversationsTable: storage.conversationsTable,
      settingsTable: storage.settingsTable,
      taskStateTable: storage.taskStateTable,
      connectionsTable: storage.connectionsTable,
      pendingMessagesTable: storage.pendingMessagesTable,
      userPool: auth.userPool,
      userPoolClient: auth.userPoolClient,
      agentRuntime: "lambda",
    });

    const template = JSON.stringify(Template.fromStack(api).toJSON());
    // Fargate SSM params must not appear — they don't exist when ComputeStack is skipped
    expect(template).not.toContain("/serverless-openclaw/compute/cluster-arn");
    expect(template).not.toContain("/serverless-openclaw/compute/task-definition-arn");
    expect(template).not.toContain("/serverless-openclaw/compute/task-role-arn");
    expect(template).not.toContain("/serverless-openclaw/compute/execution-role-arn");
  });
});

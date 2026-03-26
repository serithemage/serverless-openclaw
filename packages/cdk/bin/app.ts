#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
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

const app = new cdk.App();

const agentRuntime = process.env.AGENT_RUNTIME ?? "fargate"; // default: backward compatible
const aiProvider = process.env.AI_PROVIDER;
const aiModel = process.env.AI_MODEL;

// Secrets (SSM SecureString parameters)
const secrets = new SecretsStack(app, "SecretsStack", { aiProvider });

// Step 1-2: Network & Storage
const network = new NetworkStack(app, "NetworkStack");
const storage = new StorageStack(app, "StorageStack");

// Step 1-6: Auth
const auth = new AuthStack(app, "AuthStack");

// Step 1-7: Compute (Fargate) — skip when AGENT_RUNTIME=lambda
let compute: ComputeStack | undefined;
if (agentRuntime !== "lambda") {
  compute = new ComputeStack(app, "ComputeStack", {
    vpc: network.vpc,
    fargateSecurityGroup: network.fargateSecurityGroup,
    conversationsTable: storage.conversationsTable,
    settingsTable: storage.settingsTable,
    taskStateTable: storage.taskStateTable,
    connectionsTable: storage.connectionsTable,
    pendingMessagesTable: storage.pendingMessagesTable,
    dataBucket: storage.dataBucket,
    ecrRepository: storage.ecrRepository,
    fargateCpu: process.env.FARGATE_CPU ? Number(process.env.FARGATE_CPU) : undefined,
    fargateMemory: process.env.FARGATE_MEMORY ? Number(process.env.FARGATE_MEMORY) : undefined,
    aiProvider,
    aiModel,
  });
  compute.addDependency(secrets);
}

// Phase 2: Lambda Agent — skip when AGENT_RUNTIME=fargate
let lambdaAgent: LambdaAgentStack | undefined;
if (agentRuntime !== "fargate") {
  lambdaAgent = new LambdaAgentStack(app, "LambdaAgentStack", {
    dataBucket: storage.dataBucket,
    taskStateTable: storage.taskStateTable,
    aiProvider,
    aiModel,
  });
  lambdaAgent.addDependency(secrets);
}

// Step 1-5: API Gateway + Lambda
// Note: compute resources (TaskDef, Cluster ARNs) read from SSM to avoid cross-stack export issues
const api = new ApiStack(app, "ApiStack", {
  vpc: network.vpc,
  fargateSecurityGroup: network.fargateSecurityGroup,
  conversationsTable: storage.conversationsTable,
  settingsTable: storage.settingsTable,
  taskStateTable: storage.taskStateTable,
  connectionsTable: storage.connectionsTable,
  pendingMessagesTable: storage.pendingMessagesTable,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
  agentRuntime,
});
if (compute) {
  api.addDependency(compute);
}
api.addDependency(secrets);

// Step 1-8: Web UI (S3 + CloudFront)
new WebStack(app, "WebStack", {
  webSocketUrl: `wss://${api.webSocketApi.apiId}.execute-api.${cdk.Aws.REGION}.amazonaws.com/prod`,
  apiUrl: api.httpApi.apiEndpoint,
  userPoolId: auth.userPool.userPoolId,
  userPoolClientId: auth.userPoolClient.userPoolClientId,
});

// Monitoring Dashboard
new MonitoringStack(app, "MonitoringStack");

app.synth();

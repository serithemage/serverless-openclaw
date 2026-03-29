import { describe, it, expect, vi, beforeEach } from "vitest";
import { handler } from "../../src/handlers/ws-message.js";
import type { APIGatewayProxyEventV2WithRequestContext } from "aws-lambda";

const mockGetConnection = vi.fn();
const mockRouteMessage = vi.fn();
const mockGetTaskState = vi.fn();

vi.mock("../../src/services/connections.js", () => ({
  getConnection: (...args: unknown[]) => mockGetConnection(...args),
}));

vi.mock("../../src/services/message.js", () => ({
  routeMessage: (...args: unknown[]) => mockRouteMessage(...args),
  savePendingMessage: vi.fn(),
  sendToBridge: vi.fn(),
}));

vi.mock("../../src/services/task-state.js", () => ({
  getTaskState: (...args: unknown[]) => mockGetTaskState(...args),
  putTaskState: vi.fn(),
}));

vi.mock("../../src/services/container.js", () => ({
  startTask: vi.fn(),
}));

vi.mock("../../src/services/lambda-agent.js", () => ({
  invokeLambdaAgent: vi.fn(),
}));

vi.mock("../../src/services/secrets.js", () => ({
  resolveSecrets: vi
    .fn()
    .mockResolvedValue(
      new Map([["/serverless-openclaw/secrets/bridge-auth-token", "bridge-token"]]),
    ),
}));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: vi.fn() })) },
  GetCommand: vi.fn(),
  PutCommand: vi.fn(),
}));

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

vi.mock("@aws-sdk/client-ecs", () => ({
  ECSClient: vi.fn(() => ({ send: vi.fn() })),
  RunTaskCommand: vi.fn(),
}));

vi.mock("@aws-sdk/client-ec2", () => ({
  EC2Client: vi.fn(() => ({ send: vi.fn() })),
}));

vi.mock("@aws-sdk/client-apigatewaymanagementapi", () => ({
  ApiGatewayManagementApiClient: vi.fn(() => ({
    send: vi.fn().mockResolvedValue(undefined),
  })),
  PostToConnectionCommand: vi.fn(),
}));

function makeEvent(body: Record<string, unknown>, connectionId = "conn-abc") {
  return {
    requestContext: { connectionId },
    body: JSON.stringify(body),
  } as unknown as APIGatewayProxyEventV2WithRequestContext<never>;
}

describe("ws-message handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ECS_CLUSTER_ARN", "arn:cluster");
    vi.stubEnv("TASK_DEFINITION_ARN", "arn:taskdef");
    vi.stubEnv("SUBNET_IDS", "subnet-1,subnet-2");
    vi.stubEnv("SECURITY_GROUP_IDS", "sg-1");
    vi.stubEnv("SSM_BRIDGE_AUTH_TOKEN", "/serverless-openclaw/secrets/bridge-auth-token");
    vi.stubEnv("WEBSOCKET_CALLBACK_URL", "https://api.example.com");

    mockGetConnection.mockResolvedValue({
      PK: "CONN#conn-abc",
      userId: "user-123",
      connectedAt: "2024-01-01T00:00:00Z",
    });
    mockRouteMessage.mockResolvedValue(undefined);
  });

  it("should route sendMessage action to container", async () => {
    const event = makeEvent({ action: "sendMessage", message: "hello" });

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(mockRouteMessage).toHaveBeenCalled();
  });

  it("should return task status for getStatus action", async () => {
    mockGetTaskState.mockResolvedValueOnce({
      PK: "USER#user-123",
      status: "Running",
      taskArn: "arn:task",
      startedAt: "2024-01-01T00:00:00Z",
      lastActivity: "2024-01-01T00:00:00Z",
    });

    const event = makeEvent({ action: "getStatus" });

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body!);
    expect(body.type).toBe("status");
    expect(body.status).toBe("Running");
  });

  it("should return idle status when no task state", async () => {
    mockGetTaskState.mockResolvedValueOnce(null);

    const event = makeEvent({ action: "getStatus" });

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body!);
    expect(body.status).toBe("idle");
  });

  it("should return 400 for missing body", async () => {
    const event = {
      requestContext: { connectionId: "conn-abc" },
      body: undefined,
    } as unknown as APIGatewayProxyEventV2WithRequestContext<never>;

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
  });

  it("should pass agentRuntime and Lambda deps to routeMessage", async () => {
    vi.stubEnv("AGENT_RUNTIME", "both");
    vi.stubEnv("LAMBDA_AGENT_FUNCTION_ARN", "arn:aws:lambda:us-east-1:123:function:agent");

    const event = makeEvent({ action: "sendMessage", message: "hello" });
    await handler(event);

    const routeCall = mockRouteMessage.mock.calls[0][0];
    expect(routeCall.agentRuntime).toBe("both");
    expect(routeCall.lambdaAgentFunctionArn).toBe("arn:aws:lambda:us-east-1:123:function:agent");
    expect(routeCall.invokeLambdaAgent).toBeDefined();
    expect(routeCall.onColdStartPreview).toBeDefined();
  });

  it("should default agentRuntime to fargate when env not set", async () => {
    delete process.env.AGENT_RUNTIME;
    delete process.env.LAMBDA_AGENT_FUNCTION_ARN;

    const event = makeEvent({ action: "sendMessage", message: "hello" });
    await handler(event);

    const routeCall = mockRouteMessage.mock.calls[0][0];
    expect(routeCall.agentRuntime).toBe("fargate");
    expect(routeCall.invokeLambdaAgent).toBeUndefined();
    expect(routeCall.lambdaAgentFunctionArn).toBeUndefined();
  });

  it("should return 403 when connection not found", async () => {
    mockGetConnection.mockResolvedValueOnce(null);

    const event = makeEvent({ action: "sendMessage", message: "hello" });

    const result = await handler(event);

    expect(result.statusCode).toBe(403);
  });
});

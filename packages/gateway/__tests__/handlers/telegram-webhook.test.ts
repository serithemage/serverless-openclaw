import { describe, it, expect, vi, beforeEach } from "vitest";
import { handler } from "../../src/handlers/telegram-webhook.js";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const mockRouteMessage = vi.fn();
const mockSendTelegramMessage = vi.fn();
const mockGetTaskState = vi.fn();
const mockResolveUserId = vi.fn();
const mockVerifyOtpAndLink = vi.fn();

vi.mock("../../src/services/message.js", () => ({
  routeMessage: (...args: unknown[]) => mockRouteMessage(...args),
  savePendingMessage: vi.fn(),
  sendToBridge: vi.fn(),
}));

vi.mock("../../src/services/task-state.js", () => ({
  getTaskState: (...args: unknown[]) => mockGetTaskState(...args),
  putTaskState: vi.fn(),
}));

vi.mock("../../src/services/telegram.js", () => ({
  sendTelegramMessage: (...args: unknown[]) => mockSendTelegramMessage(...args),
}));

vi.mock("../../src/services/container.js", () => ({
  startTask: vi.fn(),
}));

vi.mock("../../src/services/identity.js", () => ({
  resolveUserId: (...args: unknown[]) => mockResolveUserId(...args),
  verifyOtpAndLink: (...args: unknown[]) => mockVerifyOtpAndLink(...args),
}));

vi.mock("../../src/services/secrets.js", () => ({
  resolveSecrets: vi.fn().mockResolvedValue(
    new Map([
      ["/serverless-openclaw/secrets/bridge-auth-token", "bridge-token"],
      ["/serverless-openclaw/secrets/telegram-bot-token", "123456:ABC-DEF"],
      ["/serverless-openclaw/secrets/telegram-webhook-secret", "my-secret"],
    ]),
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

function makeEvent(
  body: Record<string, unknown>,
  secretToken?: string,
): APIGatewayProxyEventV2 {
  return {
    headers: secretToken
      ? { "x-telegram-bot-api-secret-token": secretToken }
      : {},
    body: JSON.stringify(body),
  } as unknown as APIGatewayProxyEventV2;
}

describe("telegram-webhook handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SSM_TELEGRAM_SECRET_TOKEN", "/serverless-openclaw/secrets/telegram-webhook-secret");
    vi.stubEnv("SSM_TELEGRAM_BOT_TOKEN", "/serverless-openclaw/secrets/telegram-bot-token");
    vi.stubEnv("ECS_CLUSTER_ARN", "arn:cluster");
    vi.stubEnv("TASK_DEFINITION_ARN", "arn:taskdef");
    vi.stubEnv("SUBNET_IDS", "subnet-1");
    vi.stubEnv("SECURITY_GROUP_IDS", "sg-1");
    vi.stubEnv("SSM_BRIDGE_AUTH_TOKEN", "/serverless-openclaw/secrets/bridge-auth-token");
    vi.stubEnv("WEBSOCKET_CALLBACK_URL", "https://api.example.com");
    mockRouteMessage.mockResolvedValue(undefined);
    mockSendTelegramMessage.mockResolvedValue(undefined);
    mockGetTaskState.mockResolvedValue(null);
    mockResolveUserId.mockImplementation((_send: unknown, uid: string) => Promise.resolve(uid));
    mockVerifyOtpAndLink.mockResolvedValue({ error: "not set" });
  });

  it("should return 403 for invalid secret token", async () => {
    const event = makeEvent(
      { message: { chat: { id: 123 }, text: "hi" } },
      "wrong-secret",
    );

    const result = await handler(event);

    expect(result.statusCode).toBe(403);
    expect(mockRouteMessage).not.toHaveBeenCalled();
  });

  it("should return 403 when secret token is missing", async () => {
    const event = makeEvent({ message: { chat: { id: 123 }, text: "hi" } });

    const result = await handler(event);

    expect(result.statusCode).toBe(403);
  });

  it("should route message with valid secret token", async () => {
    mockGetTaskState.mockResolvedValue({
      status: "Running",
      publicIp: "1.2.3.4",
    });

    const event = makeEvent(
      {
        message: {
          chat: { id: 12345 },
          from: { id: 67890 },
          text: "hello bot",
        },
      },
      "my-secret",
    );

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(mockRouteMessage).toHaveBeenCalled();
  });

  it("should send cold start reply when no task exists", async () => {
    mockGetTaskState.mockResolvedValue(null);

    const event = makeEvent(
      {
        message: {
          chat: { id: 12345 },
          from: { id: 67890 },
          text: "hello",
        },
      },
      "my-secret",
    );

    await handler(event);

    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      expect.anything(),
      "123456:ABC-DEF",
      "telegram:12345",
      expect.stringContaining("Waking up"),
    );
    expect(mockRouteMessage).toHaveBeenCalled();
  });

  it("should send cold start reply when task is Starting", async () => {
    mockGetTaskState.mockResolvedValue({ status: "Starting" });

    const event = makeEvent(
      {
        message: {
          chat: { id: 12345 },
          from: { id: 67890 },
          text: "hello",
        },
      },
      "my-secret",
    );

    await handler(event);

    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      expect.anything(),
      "123456:ABC-DEF",
      "telegram:12345",
      expect.stringContaining("Waking up"),
    );
  });

  it("should NOT send cold start reply when task is Running", async () => {
    mockGetTaskState.mockResolvedValue({
      status: "Running",
      publicIp: "1.2.3.4",
    });

    const event = makeEvent(
      {
        message: {
          chat: { id: 12345 },
          from: { id: 67890 },
          text: "hello",
        },
      },
      "my-secret",
    );

    await handler(event);

    expect(mockSendTelegramMessage).not.toHaveBeenCalled();
  });

  it("should return 200 for updates without message", async () => {
    const event = makeEvent(
      { edited_message: { chat: { id: 123 }, text: "edited" } },
      "my-secret",
    );

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(mockRouteMessage).not.toHaveBeenCalled();
  });

  // ── /link command tests ──

  it("should handle /link command successfully", async () => {
    mockVerifyOtpAndLink.mockResolvedValueOnce({ cognitoUserId: "cognito-abc" });

    const event = makeEvent(
      {
        message: {
          chat: { id: 12345 },
          from: { id: 67890 },
          text: "/link 123456",
        },
      },
      "my-secret",
    );

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(mockVerifyOtpAndLink).toHaveBeenCalledWith(
      expect.anything(),
      "67890",
      "123456",
      { agentRuntime: undefined },
    );
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      "telegram:12345",
      expect.stringContaining("linked"),
    );
    expect(mockRouteMessage).not.toHaveBeenCalled();
  });

  it("should handle /link command with error", async () => {
    mockVerifyOtpAndLink.mockResolvedValueOnce({
      error: "OTP has expired or is invalid.",
    });

    const event = makeEvent(
      {
        message: {
          chat: { id: 12345 },
          from: { id: 67890 },
          text: "/link 000000",
        },
      },
      "my-secret",
    );

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      "telegram:12345",
      expect.stringContaining("expired"),
    );
    expect(mockRouteMessage).not.toHaveBeenCalled();
  });

  it("should handle /link without code", async () => {
    const event = makeEvent(
      {
        message: {
          chat: { id: 12345 },
          from: { id: 67890 },
          text: "/link ",
        },
      },
      "my-secret",
    );

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      "telegram:12345",
      expect.stringContaining("Usage"),
    );
    expect(mockVerifyOtpAndLink).not.toHaveBeenCalled();
  });

  it("should handle /unlink command", async () => {
    const event = makeEvent(
      {
        message: {
          chat: { id: 12345 },
          from: { id: 67890 },
          text: "/unlink",
        },
      },
      "my-secret",
    );

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      "telegram:12345",
      expect.stringContaining("Web UI"),
    );
    expect(mockRouteMessage).not.toHaveBeenCalled();
  });

  it("should resolve userId for linked telegram user", async () => {
    mockResolveUserId.mockResolvedValueOnce("cognito-abc");
    mockGetTaskState.mockResolvedValue({ status: "Running", publicIp: "1.2.3.4" });

    const event = makeEvent(
      {
        message: {
          chat: { id: 12345 },
          from: { id: 67890 },
          text: "hello",
        },
      },
      "my-secret",
    );

    await handler(event);

    expect(mockResolveUserId).toHaveBeenCalledWith(
      expect.anything(),
      "telegram:67890",
    );
    expect(mockRouteMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "cognito-abc",
      }),
    );
  });

  it("should include TELEGRAM_CHAT_ID in env when userId is resolved", async () => {
    mockResolveUserId.mockResolvedValueOnce("cognito-abc");
    mockGetTaskState.mockResolvedValue(null);

    const event = makeEvent(
      {
        message: {
          chat: { id: 12345 },
          from: { id: 67890 },
          text: "hello",
        },
      },
      "my-secret",
    );

    await handler(event);

    const routeCall = mockRouteMessage.mock.calls[0][0];
    const env = routeCall.startTaskParams.environment;
    expect(env).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "TELEGRAM_CHAT_ID", value: "12345" }),
      ]),
    );
  });
});

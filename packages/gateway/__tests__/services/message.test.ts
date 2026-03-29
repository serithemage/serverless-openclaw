import { describe, it, expect, vi, beforeEach } from "vitest";
import { routeMessage, savePendingMessage, sendToBridge } from "../../src/services/message.js";

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  PutCommand: vi.fn((params: unknown) => ({ input: params, _tag: "PutCommand" })),
}));

describe("message service", () => {
  const mockDynamoSend = vi.fn();
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, status: 202 });
  });

  describe("sendToBridge", () => {
    it("should POST to bridge with Bearer token and AbortSignal", async () => {
      await sendToBridge(mockFetch, "1.2.3.4", "my-token", {
        userId: "user-123",
        message: "hello",
        channel: "web",
        connectionId: "conn-1",
        callbackUrl: "https://api.example.com",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://1.2.3.4:8080/message",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Bearer my-token",
          }),
          body: expect.any(String),
          signal: expect.any(AbortSignal),
        }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.userId).toBe("user-123");
      expect(body.message).toBe("hello");
    });

    it("should throw on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(
        sendToBridge(mockFetch, "1.2.3.4", "token", {
          userId: "u",
          message: "m",
          channel: "web",
          connectionId: "c",
          callbackUrl: "https://cb",
        }),
      ).rejects.toThrow("Bridge returned 500");
    });

    it("should pass an AbortSignal that is not immediately aborted", async () => {
      await sendToBridge(mockFetch, "1.2.3.4", "token", {
        userId: "u",
        message: "m",
        channel: "web",
        connectionId: "c",
        callbackUrl: "https://cb",
      });

      const signal = mockFetch.mock.calls[0][1].signal as AbortSignal;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
    });
  });

  describe("savePendingMessage", () => {
    it("should save message with TTL to PendingMessages table", async () => {
      mockDynamoSend.mockResolvedValueOnce({});

      const item = {
        PK: "USER#user-123",
        SK: "MSG#1000#uuid-1",
        message: "hello",
        channel: "web" as const,
        connectionId: "conn-1",
        createdAt: "2024-01-01T00:00:00Z",
        ttl: 9999999999,
      };

      await savePendingMessage(mockDynamoSend, item);

      expect(mockDynamoSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: expect.stringContaining("PendingMessages"),
            Item: item,
          }),
        }),
      );
    });
  });

  describe("routeMessage", () => {
    const baseDeps = {
      userId: "user-123",
      message: "hello",
      channel: "web" as const,
      connectionId: "conn-1",
      callbackUrl: "https://cb",
      bridgeAuthToken: "token",
      startTaskParams: {
        cluster: "c",
        taskDefinition: "td",
        subnets: ["s"],
        securityGroups: ["sg"],
        containerName: "openclaw",
        environment: [],
      },
    };

    function makeDeps(overrides: Record<string, unknown> = {}) {
      return {
        ...baseDeps,
        fetchFn: mockFetch,
        getTaskState: vi.fn().mockResolvedValue(null),
        startTask: vi.fn().mockResolvedValue("arn:new-task"),
        putTaskState: vi.fn(),
        savePendingMessage: vi.fn(),
        deleteTaskState: vi.fn(),
        ...overrides,
      };
    }

    it("should send to bridge when task is Running with publicIp", async () => {
      const deps = makeDeps({
        getTaskState: vi.fn().mockResolvedValue({
          PK: "USER#user-123",
          status: "Running",
          publicIp: "1.2.3.4",
          taskArn: "arn:task",
          startedAt: "2024-01-01T00:00:00Z",
          lastActivity: "2024-01-01T00:00:00Z",
        }),
      });

      const result = await routeMessage(deps);

      expect(result).toBe("sent");
      expect(mockFetch).toHaveBeenCalled();
      expect(deps.startTask).not.toHaveBeenCalled();
      expect(deps.deleteTaskState).not.toHaveBeenCalled();
    });

    it("should save pending + start task when no active task", async () => {
      const deps = makeDeps();

      const result = await routeMessage(deps);

      expect(result).toBe("started");
      expect(mockFetch).not.toHaveBeenCalled();
      expect(deps.savePendingMessage).toHaveBeenCalled();
      expect(deps.startTask).toHaveBeenCalled();
      expect(deps.putTaskState).toHaveBeenCalledWith(
        expect.objectContaining({
          PK: "USER#user-123",
          status: "Starting",
          taskArn: "arn:new-task",
        }),
      );
    });

    it("should save pending when task is Starting (no publicIp yet)", async () => {
      const deps = makeDeps({
        getTaskState: vi.fn().mockResolvedValue({
          PK: "USER#user-123",
          status: "Starting",
          taskArn: "arn:task",
          startedAt: "2024-01-01T00:00:00Z",
          lastActivity: "2024-01-01T00:00:00Z",
        }),
      });

      const result = await routeMessage(deps);

      expect(result).toBe("queued");
      expect(deps.savePendingMessage).toHaveBeenCalled();
      expect(deps.startTask).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should claim a pre-warmed container when no user task exists", async () => {
      const deps = makeDeps({
        getTaskState: vi
          .fn()
          .mockResolvedValueOnce(null) // user's task state
          .mockResolvedValueOnce({
            // prewarm task state
            PK: "USER#system:prewarm",
            status: "Running",
            publicIp: "10.0.0.1",
            taskArn: "arn:prewarm-task",
            startedAt: "2024-01-01T00:00:00Z",
            lastActivity: "2024-01-01T00:00:00Z",
          }),
      });

      const result = await routeMessage(deps);

      expect(result).toBe("sent");
      expect(mockFetch).toHaveBeenCalledWith(
        "http://10.0.0.1:8080/message",
        expect.objectContaining({ method: "POST" }),
      );
      // Should delete prewarm TaskState
      expect(deps.deleteTaskState).toHaveBeenCalledWith("system:prewarm");
      // Should create user's TaskState with same taskArn/publicIp
      expect(deps.putTaskState).toHaveBeenCalledWith(
        expect.objectContaining({
          PK: "USER#user-123",
          taskArn: "arn:prewarm-task",
          status: "Running",
          publicIp: "10.0.0.1",
        }),
      );
      // Should NOT start a new task
      expect(deps.startTask).not.toHaveBeenCalled();
    });

    it("should fall through to normal path when prewarm bridge is unreachable", async () => {
      const failFetch = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
      const deps = makeDeps({
        fetchFn: failFetch,
        getTaskState: vi
          .fn()
          .mockResolvedValueOnce(null) // user's task state
          .mockResolvedValueOnce({
            // prewarm task state
            PK: "USER#system:prewarm",
            status: "Running",
            publicIp: "10.0.0.1",
            taskArn: "arn:prewarm-task",
            startedAt: "2024-01-01T00:00:00Z",
            lastActivity: "2024-01-01T00:00:00Z",
          }),
      });

      const result = await routeMessage(deps);

      // Should fall through to normal path (save pending + start new task)
      expect(result).toBe("started");
      expect(deps.savePendingMessage).toHaveBeenCalled();
      expect(deps.startTask).toHaveBeenCalled();
    });

    it("should skip prewarm claim when prewarm task is Starting (no publicIp)", async () => {
      const deps = makeDeps({
        getTaskState: vi
          .fn()
          .mockResolvedValueOnce(null) // user's task state
          .mockResolvedValueOnce({
            // prewarm task state — Starting, no IP
            PK: "USER#system:prewarm",
            status: "Starting",
            taskArn: "arn:prewarm-task",
            startedAt: "2024-01-01T00:00:00Z",
            lastActivity: "2024-01-01T00:00:00Z",
          }),
      });

      const result = await routeMessage(deps);

      // Should fall through to normal path
      expect(result).toBe("started");
      expect(deps.savePendingMessage).toHaveBeenCalled();
      expect(deps.startTask).toHaveBeenCalled();
      expect(deps.deleteTaskState).not.toHaveBeenCalledWith("system:prewarm");
    });

    it("should skip prewarm claim when no prewarm task exists", async () => {
      const deps = makeDeps({
        getTaskState: vi
          .fn()
          .mockResolvedValueOnce(null) // user's task state
          .mockResolvedValueOnce(null), // prewarm task state — none
      });

      const result = await routeMessage(deps);

      expect(result).toBe("started");
      expect(deps.savePendingMessage).toHaveBeenCalled();
      expect(deps.startTask).toHaveBeenCalled();
    });

    it("should fallback on bridge connection refused: save pending + delete stale state + start new task", async () => {
      const failFetch = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
      const deps = makeDeps({
        fetchFn: failFetch,
        getTaskState: vi.fn().mockResolvedValue({
          PK: "USER#user-123",
          status: "Running",
          publicIp: "1.2.3.4",
          taskArn: "arn:stale-task",
          startedAt: "2024-01-01T00:00:00Z",
          lastActivity: "2024-01-01T00:00:00Z",
        }),
      });

      const result = await routeMessage(deps);

      expect(result).toBe("started");
      expect(deps.savePendingMessage).toHaveBeenCalled();
      expect(deps.deleteTaskState).toHaveBeenCalledWith("user-123");
      expect(deps.startTask).toHaveBeenCalled();
      expect(deps.putTaskState).toHaveBeenCalledWith(
        expect.objectContaining({
          PK: "USER#user-123",
          status: "Starting",
          taskArn: "arn:new-task",
        }),
      );
    });

    it("should fallback on bridge timeout (AbortError)", async () => {
      const abortError = new DOMException("The operation was aborted", "AbortError");
      const failFetch = vi.fn().mockRejectedValue(abortError);
      const deps = makeDeps({
        fetchFn: failFetch,
        getTaskState: vi.fn().mockResolvedValue({
          PK: "USER#user-123",
          status: "Running",
          publicIp: "1.2.3.4",
          taskArn: "arn:stale-task",
          startedAt: "2024-01-01T00:00:00Z",
          lastActivity: "2024-01-01T00:00:00Z",
        }),
      });

      const result = await routeMessage(deps);

      expect(result).toBe("started");
      expect(deps.savePendingMessage).toHaveBeenCalled();
      expect(deps.deleteTaskState).toHaveBeenCalledWith("user-123");
      expect(deps.startTask).toHaveBeenCalled();
    });

    it("should fallback on bridge non-ok response (e.g. 502)", async () => {
      const failFetch = vi
        .fn()
        .mockResolvedValue({ ok: false, status: 502, statusText: "Bad Gateway" });
      const deps = makeDeps({
        fetchFn: failFetch,
        getTaskState: vi.fn().mockResolvedValue({
          PK: "USER#user-123",
          status: "Running",
          publicIp: "1.2.3.4",
          taskArn: "arn:stale-task",
          startedAt: "2024-01-01T00:00:00Z",
          lastActivity: "2024-01-01T00:00:00Z",
        }),
      });

      const result = await routeMessage(deps);

      expect(result).toBe("started");
      expect(deps.savePendingMessage).toHaveBeenCalled();
      expect(deps.deleteTaskState).toHaveBeenCalledWith("user-123");
      expect(deps.startTask).toHaveBeenCalled();
    });

    it("should invoke Lambda agent when agentRuntime is 'lambda'", async () => {
      const mockInvokeLambda = vi.fn().mockResolvedValue({
        success: true,
        payloads: [{ text: "Lambda response" }],
      });

      const deps = makeDeps({
        agentRuntime: "lambda",
        invokeLambdaAgent: mockInvokeLambda,
        lambdaAgentFunctionArn: "arn:aws:lambda:us-east-1:123:function:agent",
        sessionId: "session-456",
      });

      const result = await routeMessage(deps);

      expect(result).toBe("lambda");
      expect(mockInvokeLambda).toHaveBeenCalledWith(
        expect.objectContaining({
          functionArn: "arn:aws:lambda:us-east-1:123:function:agent",
          userId: "user-123",
          sessionId: "session-456",
          message: "hello",
          channel: "web",
        }),
      );
      // Should NOT touch Fargate path
      expect(mockFetch).not.toHaveBeenCalled();
      expect(deps.startTask).not.toHaveBeenCalled();
    });

    it("should throw when Lambda agent returns failure", async () => {
      const mockInvokeLambda = vi.fn().mockResolvedValue({
        success: false,
        error: "Agent timeout",
      });

      const deps = makeDeps({
        agentRuntime: "lambda",
        invokeLambdaAgent: mockInvokeLambda,
        lambdaAgentFunctionArn: "arn:aws:lambda:us-east-1:123:function:agent",
      });

      await expect(routeMessage(deps)).rejects.toThrow("Agent timeout");
    });

    it("should use Fargate path when agentRuntime is 'fargate'", async () => {
      const deps = makeDeps({
        agentRuntime: "fargate",
      });

      const result = await routeMessage(deps);

      // Falls through to Fargate path (no task → start new)
      expect(result).toBe("started");
      expect(deps.startTask).toHaveBeenCalled();
    });

    it("should use Fargate path when agentRuntime is not set", async () => {
      const deps = makeDeps();

      const result = await routeMessage(deps);

      expect(result).toBe("started");
      expect(deps.startTask).toHaveBeenCalled();
    });

    it("should reuse Fargate when AGENT_RUNTIME=both and container is Running", async () => {
      const mockInvokeLambda = vi.fn();
      const deps = makeDeps({
        agentRuntime: "both",
        invokeLambdaAgent: mockInvokeLambda,
        lambdaAgentFunctionArn: "arn:aws:lambda:us-east-1:123:function:agent",
        getTaskState: vi.fn().mockResolvedValue({
          PK: "USER#user-123",
          status: "Running",
          publicIp: "1.2.3.4",
          taskArn: "arn:task",
          startedAt: "2024-01-01T00:00:00Z",
          lastActivity: "2024-01-01T00:00:00Z",
        }),
      });

      const result = await routeMessage(deps);

      expect(result).toBe("sent");
      expect(mockFetch).toHaveBeenCalled();
      expect(mockInvokeLambda).not.toHaveBeenCalled();
    });

    it("should use Lambda when AGENT_RUNTIME=both and no Fargate running", async () => {
      const mockInvokeLambda = vi.fn().mockResolvedValue({
        success: true,
        payloads: [{ text: "Lambda response" }],
      });
      const deps = makeDeps({
        agentRuntime: "both",
        invokeLambdaAgent: mockInvokeLambda,
        lambdaAgentFunctionArn: "arn:aws:lambda:us-east-1:123:function:agent",
        getTaskState: vi.fn().mockResolvedValue(null),
      });

      const result = await routeMessage(deps);

      expect(result).toBe("lambda");
      expect(mockInvokeLambda).toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(deps.startTask).not.toHaveBeenCalled();
    });

    it("should start Fargate when AGENT_RUNTIME=both and message has /heavy hint", async () => {
      const mockInvokeLambda = vi.fn();
      const deps = makeDeps({
        agentRuntime: "both",
        invokeLambdaAgent: mockInvokeLambda,
        lambdaAgentFunctionArn: "arn:aws:lambda:us-east-1:123:function:agent",
        message: "/heavy do something",
        getTaskState: vi.fn().mockResolvedValue(null),
      });

      const result = await routeMessage(deps);

      expect(result).toBe("started");
      expect(mockInvokeLambda).not.toHaveBeenCalled();
      expect(deps.startTask).toHaveBeenCalled();
      expect(deps.savePendingMessage).toHaveBeenCalled();
    });

    it("should invoke cold start preview when AGENT_RUNTIME=both and fargate-new cold starts", async () => {
      const mockInvokeLambda = vi.fn().mockResolvedValue({
        success: true,
        payloads: [{ text: "Here's some context while you wait..." }],
      });
      const mockPreviewCallback = vi.fn();
      const deps = makeDeps({
        agentRuntime: "both",
        invokeLambdaAgent: mockInvokeLambda,
        lambdaAgentFunctionArn: "arn:aws:lambda:us-east-1:123:function:agent",
        message: "/heavy do something complex",
        getTaskState: vi.fn().mockResolvedValue(null),
        onColdStartPreview: mockPreviewCallback,
      });

      const result = await routeMessage(deps);

      expect(result).toBe("started");
      expect(deps.startTask).toHaveBeenCalled();
      // Preview is fire-and-forget, wait for it to settle
      await new Promise((r) => setTimeout(r, 10));
      expect(mockInvokeLambda).toHaveBeenCalledWith(
        expect.objectContaining({
          disableTools: true,
          message: "/heavy do something complex",
        }),
      );
      expect(mockPreviewCallback).toHaveBeenCalledWith("Here's some context while you wait...");
    });

    it("should not fail routing when cold start preview fails", async () => {
      const mockInvokeLambda = vi
        .fn()
        .mockResolvedValueOnce({ success: false, error: "preview failed" }); // preview
      const mockPreviewCallback = vi.fn();
      const deps = makeDeps({
        agentRuntime: "both",
        invokeLambdaAgent: mockInvokeLambda,
        lambdaAgentFunctionArn: "arn:aws:lambda:us-east-1:123:function:agent",
        message: "/fargate analyze data",
        getTaskState: vi.fn().mockResolvedValue(null),
        onColdStartPreview: mockPreviewCallback,
      });

      const result = await routeMessage(deps);

      expect(result).toBe("started");
      await new Promise((r) => setTimeout(r, 10));
      expect(mockPreviewCallback).not.toHaveBeenCalled();
    });

    it("should not invoke preview when onColdStartPreview callback is not provided", async () => {
      const mockInvokeLambda = vi.fn();
      const deps = makeDeps({
        agentRuntime: "both",
        invokeLambdaAgent: mockInvokeLambda,
        lambdaAgentFunctionArn: "arn:aws:lambda:us-east-1:123:function:agent",
        message: "/heavy build report",
        getTaskState: vi.fn().mockResolvedValue(null),
        // no onColdStartPreview
      });

      const result = await routeMessage(deps);

      expect(result).toBe("started");
      await new Promise((r) => setTimeout(r, 10));
      // Lambda should NOT have been called for preview (only for routing)
      expect(mockInvokeLambda).not.toHaveBeenCalled();
    });

    it("should fallback to Fargate when AGENT_RUNTIME=both and Lambda fails", async () => {
      const mockInvokeLambda = vi.fn().mockResolvedValue({
        success: false,
        error: "Lambda timeout",
      });
      const deps = makeDeps({
        agentRuntime: "both",
        invokeLambdaAgent: mockInvokeLambda,
        lambdaAgentFunctionArn: "arn:aws:lambda:us-east-1:123:function:agent",
        getTaskState: vi.fn().mockResolvedValue(null),
      });

      const result = await routeMessage(deps);

      expect(result).toBe("started");
      expect(mockInvokeLambda).toHaveBeenCalled();
      expect(deps.startTask).toHaveBeenCalled();
    });
  });
});

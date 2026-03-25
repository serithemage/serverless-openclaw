import {
  GetCommand,
  PutCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  TABLE_NAMES,
  KEY_PREFIX,
  OTP_TTL_SEC,
  OTP_LENGTH,
} from "@serverless-openclaw/shared";
import crypto from "node:crypto";

type Send = (command: unknown) => Promise<unknown>;

interface GetResult {
  Item?: Record<string, unknown>;
}

export async function resolveUserId(
  send: Send,
  userId: string,
): Promise<string> {
  if (!userId.startsWith("telegram:")) return userId;

  const result = (await send(
    new GetCommand({
      TableName: TABLE_NAMES.SETTINGS,
      Key: {
        PK: `${KEY_PREFIX.USER}${userId}`,
        SK: `${KEY_PREFIX.SETTING}linked-cognito`,
      },
    }),
  )) as GetResult;

  const linked = result.Item?.value as { cognitoUserId: string } | undefined;
  return linked?.cognitoUserId ?? userId;
}

export async function generateOtp(
  send: Send,
  cognitoUserId: string,
): Promise<string> {
  const min = 10 ** (OTP_LENGTH - 1);
  const max = 10 ** OTP_LENGTH;
  const code = String(crypto.randomInt(min, max));
  const ttl = Math.floor(Date.now() / 1000) + OTP_TTL_SEC;

  // Store OTP for the cognito user
  await send(
    new PutCommand({
      TableName: TABLE_NAMES.SETTINGS,
      Item: {
        PK: `${KEY_PREFIX.USER}${cognitoUserId}`,
        SK: `${KEY_PREFIX.SETTING}telegram-otp`,
        value: { code },
        ttl,
      },
    }),
  );

  // Store reverse lookup by OTP code
  await send(
    new PutCommand({
      TableName: TABLE_NAMES.SETTINGS,
      Item: {
        PK: `${KEY_PREFIX.USER}otp:${code}`,
        SK: `${KEY_PREFIX.SETTING}otp-owner`,
        value: { cognitoUserId },
        ttl,
      },
    }),
  );

  return code;
}

export async function verifyOtpAndLink(
  send: Send,
  telegramUserId: string,
  code: string,
  options?: { agentRuntime?: string },
): Promise<{ cognitoUserId: string } | { error: string }> {
  const telegramKey = `telegram:${telegramUserId}`;

  // 1. Look up OTP (non-destructive) to find cognitoUserId
  const otpLookup = (await send(
    new GetCommand({
      TableName: TABLE_NAMES.SETTINGS,
      Key: {
        PK: `${KEY_PREFIX.USER}otp:${code}`,
        SK: `${KEY_PREFIX.SETTING}otp-owner`,
      },
    }),
  )) as GetResult;

  const otpOwner = otpLookup.Item?.value as
    | { cognitoUserId: string }
    | undefined;
  if (!otpOwner) {
    return { error: "OTP has expired or is invalid." };
  }
  const cognitoUserId = otpOwner.cognitoUserId;

  // 2. Check if telegram user has a running container (Fargate only)
  if (options?.agentRuntime !== "lambda") {
    const taskResult = (await send(
      new GetCommand({
        TableName: TABLE_NAMES.TASK_STATE,
        Key: { PK: `${KEY_PREFIX.USER}${telegramKey}` },
      }),
    )) as GetResult;

    const taskState = taskResult.Item as
      | { status: string }
      | undefined;
    if (taskState && taskState.status !== "Idle") {
      return {
        error:
          "A Telegram container is currently running. Please try again in about 15 minutes.",
      };
    }
  }

  // 3. Check if telegram is already linked to a different account
  const existingLink = (await send(
    new GetCommand({
      TableName: TABLE_NAMES.SETTINGS,
      Key: {
        PK: `${KEY_PREFIX.USER}${telegramKey}`,
        SK: `${KEY_PREFIX.SETTING}linked-cognito`,
      },
    }),
  )) as GetResult;

  const existing = existingLink.Item?.value as
    | { cognitoUserId: string }
    | undefined;
  if (existing && existing.cognitoUserId !== cognitoUserId) {
    return {
      error: "This Telegram account is already linked to a different account.",
    };
  }

  // 4. Atomically consume OTP (prevents race condition with concurrent /link)
  try {
    await send(
      new DeleteCommand({
        TableName: TABLE_NAMES.SETTINGS,
        Key: {
          PK: `${KEY_PREFIX.USER}otp:${code}`,
          SK: `${KEY_PREFIX.SETTING}otp-owner`,
        },
        ConditionExpression: "attribute_exists(PK)",
      }),
    );
  } catch (err: unknown) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
      return { error: "OTP has expired or is invalid." };
    }
    throw err;
  }

  // 6. Create bilateral links
  await send(
    new PutCommand({
      TableName: TABLE_NAMES.SETTINGS,
      Item: {
        PK: `${KEY_PREFIX.USER}${cognitoUserId}`,
        SK: `${KEY_PREFIX.SETTING}linked-telegram`,
        value: { telegramUserId },
      },
    }),
  );

  await send(
    new PutCommand({
      TableName: TABLE_NAMES.SETTINGS,
      Item: {
        PK: `${KEY_PREFIX.USER}${telegramKey}`,
        SK: `${KEY_PREFIX.SETTING}linked-cognito`,
        value: { cognitoUserId },
      },
    }),
  );

  // 7. Clean up remaining OTP record (reverse lookup already deleted in step 4)
  await send(
    new DeleteCommand({
      TableName: TABLE_NAMES.SETTINGS,
      Key: {
        PK: `${KEY_PREFIX.USER}${cognitoUserId}`,
        SK: `${KEY_PREFIX.SETTING}telegram-otp`,
      },
    }),
  );

  return { cognitoUserId };
}

export async function getLinkStatus(
  send: Send,
  cognitoUserId: string,
): Promise<{ linked: boolean; telegramUserId?: string }> {
  const result = (await send(
    new GetCommand({
      TableName: TABLE_NAMES.SETTINGS,
      Key: {
        PK: `${KEY_PREFIX.USER}${cognitoUserId}`,
        SK: `${KEY_PREFIX.SETTING}linked-telegram`,
      },
    }),
  )) as GetResult;

  const linked = result.Item?.value as
    | { telegramUserId: string }
    | undefined;
  if (linked) {
    return { linked: true, telegramUserId: linked.telegramUserId };
  }
  return { linked: false };
}

export async function unlinkTelegram(
  send: Send,
  cognitoUserId: string,
): Promise<void> {
  // Find current link
  const result = (await send(
    new GetCommand({
      TableName: TABLE_NAMES.SETTINGS,
      Key: {
        PK: `${KEY_PREFIX.USER}${cognitoUserId}`,
        SK: `${KEY_PREFIX.SETTING}linked-telegram`,
      },
    }),
  )) as GetResult;

  const linked = result.Item?.value as
    | { telegramUserId: string }
    | undefined;
  if (!linked) return;

  // Delete bilateral links
  await send(
    new DeleteCommand({
      TableName: TABLE_NAMES.SETTINGS,
      Key: {
        PK: `${KEY_PREFIX.USER}${cognitoUserId}`,
        SK: `${KEY_PREFIX.SETTING}linked-telegram`,
      },
    }),
  );

  await send(
    new DeleteCommand({
      TableName: TABLE_NAMES.SETTINGS,
      Key: {
        PK: `${KEY_PREFIX.USER}telegram:${linked.telegramUserId}`,
        SK: `${KEY_PREFIX.SETTING}linked-cognito`,
      },
    }),
  );
}

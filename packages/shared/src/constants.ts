// DynamoDB Table Names
export const TABLE_NAMES = {
  CONVERSATIONS: "serverless-openclaw-Conversations",
  SETTINGS: "serverless-openclaw-Settings",
  TASK_STATE: "serverless-openclaw-TaskState",
  CONNECTIONS: "serverless-openclaw-Connections",
  PENDING_MESSAGES: "serverless-openclaw-PendingMessages",
} as const;

// DynamoDB Key Prefixes
export const KEY_PREFIX = {
  USER: "USER#",
  CONV: "CONV#",
  MSG: "MSG#",
  SETTING: "SETTING#",
  CONN: "CONN#",
} as const;

// Ports
export const BRIDGE_PORT = 8080;
export const GATEWAY_PORT = 18789;

// Timeouts (ms)
export const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
export const PENDING_MESSAGE_TTL_SEC = 5 * 60;
export const CONNECTION_TTL_SEC = 24 * 60 * 60;
export const PERIODIC_BACKUP_INTERVAL_MS = 5 * 60 * 1000;

// Identity Linking (OTP)
export const OTP_TTL_SEC = 300;
export const OTP_LENGTH = 6;

// Watchdog
export const WATCHDOG_INTERVAL_MINUTES = 5;
export const MIN_UPTIME_MINUTES = 5;

// Cloudflare Containers
export const CF_CONTAINER_SLEEP_AFTER = "15m";
export const CF_CONTAINER_DEFAULT_PORT = 8080;

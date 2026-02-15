import type { Container } from "@cloudflare/containers";

export interface Env {
  // Cloudflare Container (Durable Object binding)
  OPENCLAW_CONTAINER: DurableObjectNamespace<Container>;

  // D1 Database
  DB: D1Database;

  // R2 Bucket
  DATA_BUCKET: R2Bucket;

  // KV Namespace (ephemeral session state)
  SESSIONS: KVNamespace;

  // Static Assets (Web UI)
  ASSETS: Fetcher;

  // Secrets (set via `wrangler secret put`)
  BRIDGE_AUTH_TOKEN: string;
  OPENCLAW_GATEWAY_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_SECRET_TOKEN: string;

  // Variables (auth config)
  COGNITO_USER_POOL_ID: string;
  COGNITO_CLIENT_ID: string;
  COGNITO_ISSUER: string;
}

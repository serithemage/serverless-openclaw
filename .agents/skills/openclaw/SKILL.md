---
name: openclaw
description: References OpenClaw internals and integration points. Covers Gateway protocol, agent runtime, session management, tool system, and serverless integration. Use when working with OpenClaw APIs or debugging agent behavior.
allowed-tools: Read, Glob, Grep
---

# OpenClaw Internals Reference

Full analysis: [docs/openclaw-analysis.md](../../../docs/openclaw-analysis.md)

## Key Facts

| Property        | Value                                                   |
| --------------- | ------------------------------------------------------- |
| Version pinned  | v2026.2.13 (v2026.2.14 breaks — default-deny scope)     |
| Codebase size   | ~675K lines TypeScript                                  |
| Runtime         | Node.js >=22.12.0, pnpm monorepo, tsdown bundler        |
| Gateway WS port | :18789                                                  |
| HTTP port       | :18790                                                  |
| Config path     | `~/.openclaw/openclaw.json` (NOT `~/.config/openclaw/`) |
| Session files   | `~/.openclaw/agents/{id}/sessions/{sid}.jsonl`          |

## Entry Points

| Entry                  | Purpose                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `runEmbeddedPiAgent()` | Run agent in-process, independent of Gateway WS server — the key Lambda integration point |
| `extensionAPI.js`      | Library entry point (NOT in `package.json` exports map — must use `file://` URL import)   |
| `openclaw gateway run` | Start full Gateway WS server (subcommand required, plain `openclaw gateway` just waits)   |

```typescript
// Correct import pattern for Lambda
const ocRoot = process.env.OPENCLAW_ROOT!;
const { extensionAPI } = await import(`file://${ocRoot}/dist/extensionAPI.js`);
```

## SessionManager

- `SessionManager.open(id)` — synchronous fs read, JSONL format
- Returns `[]` if session file is missing (safe to call on first run)
- Sessions are append-only JSONL transcripts, compacted periodically
- `SessionLock` prevents concurrent access to same session (critical for Lambda concurrency)

## Gateway Protocol (JSON-RPC 2.0 over WebSocket)

### Handshake Sequence

```
1. GW → client:  { type: "event", event: "connect.challenge", data: { challenge } }
2. client → GW:  { type: "req", id: 1, method: "connect", params: { client: { id: "gateway-client", mode: "backend" }, response: <challenge-response> } }
3. GW → client:  { type: "res", id: 1, result: { status: "hello-ok", snapshot: { sessionDefaults: { mainSessionKey } } } }
```

### Sending a Message

```typescript
// sessionKey obtained from hello-ok snapshot
{ type: "req", id: 2, method: "chat.send", params: { sessionKey, message: "..." } }
```

### Streaming Response

```typescript
// Stream chunks
{ type: "event", event: "chat", data: { state: "delta", content: "..." } }
// Final
{ type: "event", event: "chat", data: { state: "final", content: "..." } }
// Error
{ type: "event", event: "chat", data: { state: "error", error: "..." } }
```

### Valid `client` Field Values

- `client.id`: `"cli"`, `"gateway-client"`, `"webchat-ui"`, etc. (TypeBox Literal)
- `client.mode`: `"cli"`, `"backend"`, `"ui"`, `"node"` — **NOT** `"operator"` (invalid)
- `device` field: **Optional** — omit entirely (empty publicKey/signature strings fail validation)

## Config Requirements

```json
{
  "gateway": { "mode": "local" },
  "auth": { "method": "env" }
}
```

- `auth.method` key: removed in recent versions (invalid if present)
- `gateway.mode: "local"` required for embedded operation
- API keys via env vars only — never write to `openclaw.json`

## Serverless Blockers (and How We Solved Them)

| Blocker                       | Problem               | Solution                                     |
| ----------------------------- | --------------------- | -------------------------------------------- |
| Persistent WS server          | Always-running :18789 | Use `runEmbeddedPiAgent()` instead           |
| Long-lived runs (10 min)      | Lambda timeout        | Lambda 15-min timeout + structured streaming |
| In-process tools (filesystem) | `/tmp` only in Lambda | HOME=/tmp, sessions in /tmp                  |
| SQLite vector store           | Write access needed   | /tmp mount                                   |
| Plugin loading (~30-35s)      | Cold start overhead   | Bedrock discovery disabled, pre-loaded       |
| Bedrock auto-discovery        | 56s scan on startup   | `bedrockDiscovery.enabled: false`            |

## Fargate vs Lambda Runtime

| Aspect           | Fargate (Phase 1)        | Lambda (Phase 2)            |
| ---------------- | ------------------------ | --------------------------- |
| Entry            | `openclaw gateway run`   | `runEmbeddedPiAgent()`      |
| Session state    | Persistent (~/.openclaw) | /tmp (ephemeral)            |
| Cold start       | 40-57s                   | 1.35s                       |
| Concurrent users | 1 per task               | Many (separate invocations) |
| Cost             | ~$0/month idle           | Per-invocation              |

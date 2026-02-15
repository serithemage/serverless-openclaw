/**
 * JWT verification for Cognito tokens.
 *
 * Verifies the token using Cognito JWKS (JSON Web Key Set).
 * Caches the JWKS for 1 hour to avoid repeated fetches.
 */

interface JWKSKey {
  kid: string;
  kty: string;
  alg: string;
  use: string;
  n: string;
  e: string;
}

interface JWKS {
  keys: JWKSKey[];
}

interface JWTPayload {
  sub: string;
  iss: string;
  aud?: string;
  client_id?: string;
  token_use: string;
  exp: number;
  iat: number;
  email?: string;
}

// In-memory JWKS cache (per Worker isolate)
let cachedJwks: JWKS | null = null;
let jwksCachedAt = 0;
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function base64urlToArrayBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function decodeJwtPayload(token: string): JWTPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");
  const payload = JSON.parse(
    new TextDecoder().decode(base64urlToArrayBuffer(parts[1])),
  );
  return payload as JWTPayload;
}

function getJwtHeader(token: string): { kid: string; alg: string } {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");
  return JSON.parse(
    new TextDecoder().decode(base64urlToArrayBuffer(parts[0])),
  ) as { kid: string; alg: string };
}

async function fetchJwks(issuer: string): Promise<JWKS> {
  const now = Date.now();
  if (cachedJwks && now - jwksCachedAt < JWKS_CACHE_TTL_MS) {
    return cachedJwks;
  }

  const url = `${issuer}/.well-known/jwks.json`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch JWKS: ${resp.status}`);
  }
  cachedJwks = (await resp.json()) as JWKS;
  jwksCachedAt = now;
  return cachedJwks;
}

async function importKey(jwk: JWKSKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e,
      alg: jwk.alg,
      use: jwk.use,
    },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

export async function verifyJwt(
  token: string,
  issuer: string,
  clientId: string,
): Promise<JWTPayload> {
  // Decode header and payload
  const header = getJwtHeader(token);
  const payload = decodeJwtPayload(token);

  // Verify claims
  if (payload.iss !== issuer) {
    throw new Error("Invalid issuer");
  }
  if (payload.token_use !== "id") {
    throw new Error("Invalid token_use");
  }
  // Cognito id tokens use "aud" for client_id
  if (payload.aud !== clientId && payload.client_id !== clientId) {
    throw new Error("Invalid audience");
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Token expired");
  }

  // Verify signature
  const jwks = await fetchJwks(issuer);
  const key = jwks.keys.find((k) => k.kid === header.kid);
  if (!key) {
    throw new Error("Key not found in JWKS");
  }

  const cryptoKey = await importKey(key);
  const parts = token.split(".");
  const signatureBytes = base64urlToArrayBuffer(parts[2]);
  const dataBytes = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    signatureBytes,
    dataBytes,
  );

  if (!valid) {
    throw new Error("Invalid signature");
  }

  return payload;
}

/**
 * Extract userId from Bearer token in Authorization header.
 */
export async function authenticateRequest(
  request: Request,
  issuer: string,
  clientId: string,
): Promise<string | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  try {
    const token = authHeader.slice(7);
    const payload = await verifyJwt(token, issuer, clientId);
    return payload.sub;
  } catch {
    return null;
  }
}

// Short-lived, single-use artifacts for the OAuth code-exchange flow, kept in
// Redis with a native TTL. Both use GETDEL so a value can be redeemed exactly
// once — a replay finds nothing.
//
//   oauth:state:<state>  { client, redirectUri }   — set before redirecting to
//        the provider, read back in the callback (also serves as a CSRF nonce).
//   oauth:code:<code>    { userId, client }         — issued by the callback,
//        redeemed by POST /api/auth/exchange for a JWT.
import crypto from "node:crypto";
import { redis } from "../config/redis.js";

export type OAuthClient = "web" | "mobile";

const STATE_PREFIX = "oauth:state:";
const CODE_PREFIX = "oauth:code:";
const STATE_TTL_SECONDS = 10 * 60; // provider consent screens can be slow
const CODE_TTL_SECONDS = 60; // exchanged immediately by the client

export interface OAuthStateContext {
  client: OAuthClient;
  redirectUri: string;
}

export interface AuthCodePayload {
  userId: string;
  client: OAuthClient;
}

function randomToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export async function createOAuthState(ctx: OAuthStateContext): Promise<string> {
  const state = randomToken();
  await redis.set(STATE_PREFIX + state, JSON.stringify(ctx), "EX", STATE_TTL_SECONDS);
  return state;
}

export async function consumeOAuthState(state: string): Promise<OAuthStateContext | null> {
  if (!state) return null;
  const raw = await redis.getdel(STATE_PREFIX + state);
  return raw ? (JSON.parse(raw) as OAuthStateContext) : null;
}

/**
 * Issue a single-use authorization code for `userId`. `ttlSeconds` is overridable
 * so tests can exercise expiry without long waits.
 */
export async function createAuthCode(
  payload: AuthCodePayload,
  ttlSeconds: number = CODE_TTL_SECONDS,
): Promise<string> {
  const code = randomToken();
  await redis.set(CODE_PREFIX + code, JSON.stringify(payload), "EX", ttlSeconds);
  return code;
}

export async function consumeAuthCode(code: string): Promise<AuthCodePayload | null> {
  if (!code) return null;
  const raw = await redis.getdel(CODE_PREFIX + code);
  return raw ? (JSON.parse(raw) as AuthCodePayload) : null;
}

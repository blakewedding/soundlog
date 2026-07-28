/**
 * The refresh-token cookie's name and attributes, in one place.
 *
 * Extracted from `routes/auth.ts` in 6.2b, when the password-change endpoint
 * needed to issue a fresh refresh token too. The alternative — importing the
 * helper from `routes/auth.ts` — would execute that module's entire router
 * construction as a side effect of wanting one constant.
 *
 * Duplicating the attributes instead would have been worse than either: a
 * second definition that drifted on `path` or `sameSite` produces a cookie the
 * browser stores but never sends back, and the symptom is "logged out an hour
 * later" rather than anything that points at a cookie.
 */
import type { CookieOptions } from "express";
import { cookieSecure, env } from "./env.js";

export const REFRESH_COOKIE = "refresh_token";

export function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    // Follows the app's own scheme, not NODE_ENV — see cookieSecure in
    // config/env.ts for why those two must not be conflated.
    secure: cookieSecure,
    // The SPA and /api are one origin, so every request carrying this cookie is
    // same-site; `lax` costs nothing and blocks cross-site POSTs.
    sameSite: "lax",
    // Scoped to the only routes that redeem it. Note this is about where the
    // browser SENDS the cookie, not where it may be SET from — /api/me/password
    // sets it with this path and the browser then offers it to /api/auth/*.
    path: "/api/auth",
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}

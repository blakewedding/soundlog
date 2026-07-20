// Phase 1: email/password + Spotify & Google OAuth via Passport.
//
// Access tokens are returned in the JSON body (the client keeps them in memory).
// The rotating refresh token is delivered two ways: as an httpOnly cookie scoped
// to /api/auth for the web app, or in the JSON body for the mobile app (which
// has no cookie jar and stores it in the device keychain).
//
// OAuth never puts a token in a redirect URL. The provider callback issues a
// short-lived, single-use code and redirects with `?code=`; the client then
// POSTs that code to /exchange to obtain the JWT. This keeps tokens out of
// browser history / server logs and gives the same shape to web and to the
// expo-auth-session mobile flow.
import { Router } from "express";
import type { CookieOptions, NextFunction, Request, Response } from "express";
import type { AuthenticateOptions } from "passport";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import { prisma } from "../config/database.js";
import { env } from "../config/env.js";
import { passport, oauthProviders, type OAuthProvider } from "../config/passport.js";
import { registerUser, verifyCredentials, toPublicUser } from "../services/authService.js";
import {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
} from "../services/tokenService.js";
import {
  createOAuthState,
  consumeOAuthState,
  createAuthCode,
  consumeAuthCode,
  type OAuthClient,
} from "../services/oauthCodeService.js";

export const authRouter = Router();

const REFRESH_COOKIE = "refresh_token";

function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}

const registerSchema = z.object({
  username: z.string().min(3).max(24).regex(/^[a-z0-9_]+$/i),
  email: z.string().email(),
  password: z.string().min(10),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const exchangeSchema = z.object({
  code: z.string().min(1),
});

/** Deliver a freshly issued refresh token by the mechanism the client expects. */
function deliverRefreshToken(res: Response, client: OAuthClient, token: string) {
  if (client === "mobile") return; // returned in the JSON body by the caller
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions());
}

// ---------------------------------------------------------------------------
// Email / password
// ---------------------------------------------------------------------------

authRouter.post("/register", validate(registerSchema), async (req, res, next) => {
  try {
    const user = await registerUser(req.body);
    const refreshToken = await issueRefreshToken(user.id);
    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
    res.status(201).json({ user: toPublicUser(user), accessToken: signAccessToken(user.id) });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", validate(loginSchema), async (req, res, next) => {
  try {
    const user = await verifyCredentials(req.body.email, req.body.password);
    const refreshToken = await issueRefreshToken(user.id);
    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
    res.json({ user: toPublicUser(user), accessToken: signAccessToken(user.id) });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/refresh", async (req, res, next) => {
  try {
    // Web presents the token via the httpOnly cookie; mobile via the body.
    const fromCookie: string | undefined = req.cookies?.[REFRESH_COOKIE];
    const fromBody =
      typeof req.body?.refreshToken === "string" ? (req.body.refreshToken as string) : undefined;
    const presented = fromCookie ?? fromBody;
    if (!presented) throw new HttpError(401, "Missing refresh token");

    const { userId, token } = await rotateRefreshToken(presented);
    const accessToken = signAccessToken(userId);

    if (fromCookie) {
      res.cookie(REFRESH_COOKIE, token, refreshCookieOptions());
      return res.json({ accessToken });
    }
    return res.json({ accessToken, refreshToken: token });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    const presented: string | undefined =
      req.cookies?.[REFRESH_COOKIE] ??
      (typeof req.body?.refreshToken === "string" ? req.body.refreshToken : undefined);
    if (presented) await revokeRefreshToken(presented);
    res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) throw new HttpError(404, "User not found");
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// OAuth code exchange
// ---------------------------------------------------------------------------

// The client redeems the single-use code from the OAuth redirect for a JWT.
// Web receives the refresh token as an httpOnly cookie; mobile in the body.
authRouter.post("/exchange", validate(exchangeSchema), async (req, res, next) => {
  try {
    const payload = await consumeAuthCode(req.body.code);
    if (!payload) throw new HttpError(400, "Invalid or expired authorization code");

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) throw new HttpError(401, "Account no longer exists");

    const accessToken = signAccessToken(user.id);
    const refreshToken = await issueRefreshToken(user.id);
    deliverRefreshToken(res, payload.client, refreshToken);

    const body: Record<string, unknown> = { user: toPublicUser(user), accessToken };
    if (payload.client === "mobile") body.refreshToken = refreshToken;
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// OAuth (Spotify + Google)
// ---------------------------------------------------------------------------

const OAUTH_SCOPES: Record<OAuthProvider, string[]> = {
  spotify: ["user-read-email", "user-read-private"],
  google: ["profile", "email"],
};

/**
 * Only allow the mobile flow to bounce back to the app's own custom scheme or
 * the Expo auth proxy — never an arbitrary http(s) host, which would let an
 * attacker's redirect capture the code.
 */
export function isAllowedMobileRedirect(uri: string): boolean {
  if (!uri) return false;
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (parsed.protocol === `${env.MOBILE_APP_SCHEME}:`) return true;
  if (parsed.protocol === "https:" && (parsed.hostname === "auth.expo.io" || parsed.hostname === "auth.expo.dev")) {
    return true;
  }
  return false;
}

/** Append a query param, respecting whether the base already has a query string. */
export function appendQueryParam(base: string, key: string, value: string): string {
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}${key}=${encodeURIComponent(value)}`;
}

function oauthStart(provider: OAuthProvider) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!oauthProviders[provider]) {
        return res.status(503).json({ error: `${provider} OAuth is not configured` });
      }

      const client: OAuthClient = req.query.client === "mobile" ? "mobile" : "web";
      let redirectUri: string;
      if (client === "mobile") {
        redirectUri = String(req.query.redirect_uri ?? "");
        if (!isAllowedMobileRedirect(redirectUri)) {
          return res.status(400).json({ error: "Invalid or missing mobile redirect_uri" });
        }
      } else {
        redirectUri = `${env.CLIENT_URL}/auth/callback`;
      }

      // The state doubles as a CSRF nonce and as the carrier for where to send
      // the browser once the provider bounces back.
      const state = await createOAuthState({ client, redirectUri });
      const options: AuthenticateOptions = { scope: OAUTH_SCOPES[provider], session: false, state };
      passport.authenticate(provider, options)(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

function oauthCallback(provider: OAuthProvider) {
  return [
    (req: Request, res: Response, next: NextFunction) => {
      if (!oauthProviders[provider]) {
        return res.status(503).json({ error: `${provider} OAuth is not configured` });
      }
      passport.authenticate(provider, {
        session: false,
        failureRedirect: `${env.CLIENT_URL}/login?error=oauth_failed`,
      })(req, res, next);
    },
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = await consumeOAuthState(String(req.query.state ?? ""));
        if (!ctx) {
          return res.redirect(`${env.CLIENT_URL}/login?error=invalid_state`);
        }
        const { id } = req.user as { id: string };
        const code = await createAuthCode({ userId: id, client: ctx.client });
        res.redirect(appendQueryParam(ctx.redirectUri, "code", code));
      } catch (err) {
        next(err);
      }
    },
  ];
}

authRouter.get("/spotify", oauthStart("spotify"));
authRouter.get("/spotify/callback", oauthCallback("spotify"));
authRouter.get("/google", oauthStart("google"));
authRouter.get("/google/callback", oauthCallback("google"));

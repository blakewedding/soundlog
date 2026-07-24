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
import { env, cookieSecure } from "../config/env.js";
import { passport, oauthProviders, type OAuthProvider } from "../config/passport.js";
import {
  registerUser,
  verifyCredentials,
  toPublicUser,
  sendVerificationEmail,
  resetUserPassword,
} from "../services/authService.js";
import {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokens,
} from "../services/tokenService.js";
import {
  issueVerificationToken,
  consumeVerificationToken,
  verificationLink,
} from "../services/verificationService.js";
import { sendEmail, passwordResetEmail, emailConfigured } from "../services/emailService.js";
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
    // Follows the app's own scheme, not NODE_ENV — see cookieSecure in
    // config/env.ts for why those two must not be conflated.
    secure: cookieSecure,
    // The SPA and /api are one origin, so every request carrying this cookie is
    // same-site; `lax` costs nothing and blocks cross-site POSTs.
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

const tokenSchema = z.object({
  token: z.string().min(1),
});

const forgotSchema = z.object({
  email: z.string().email(),
});

// Same minimum as registration. A reset path that accepts a weaker password
// than the front door is a way around the front door.
const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(10),
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
// Email verification & password reset
//
// Launch policy (Phase 6b): an unverified account is a FULL account. It can log
// in and use the site; the UI shows a reminder. Hard-blocking sign-in on
// verification would mean that any wobble in mail delivery locks out every new
// user, including the first one, with no way back in — the failure mode is
// total and self-inflicted. Verification gates nothing yet; when it does, it
// will gate specific actions, not the door.
// ---------------------------------------------------------------------------

authRouter.post("/verify-email", validate(tokenSchema), async (req, res, next) => {
  try {
    const userId = await consumeVerificationToken(req.body.token, "EMAIL_VERIFICATION");
    // Idempotent in effect: a second, different valid token simply rewrites the
    // same timestamp. (The token itself is still strictly single-use.)
    const user = await prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/resend-verification", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) throw new HttpError(404, "User not found");
    // Already verified: succeed without sending. Telling the caller "you didn't
    // need that" is friendlier than an error, and sending anyway trains people
    // to click stale links.
    if (!user.emailVerifiedAt) await sendVerificationEmail(user);
    res.json({ sent: !user.emailVerifiedAt, emailConfigured: emailConfigured() });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/forgot-password", validate(forgotSchema), async (req, res, next) => {
  try {
    const email = req.body.email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });

    // An OAuth-only account has no password to reset; sending a reset link
    // would let anyone with mailbox access CREATE one, converting a
    // Google-only account into a password account. Skip silently — the
    // response is identical either way.
    if (user?.password) {
      try {
        const token = await issueVerificationToken(user.id, "PASSWORD_RESET");
        const link = verificationLink("/reset-password", token);
        await sendEmail({ to: user.email, ...passwordResetEmail(link) });
      } catch (err) {
        // Fault-isolated: the response must not vary with mail success either,
        // or timing and status codes become the enumeration oracle that the
        // constant response exists to close.
        console.warn(`[auth] reset email failed: ${(err as Error).message}`);
      }
    }

    // ALWAYS the same answer, whether or not that address has an account. This
    // endpoint is unauthenticated, so any difference in status, body or shape
    // turns it into a "does this person use Soundlog" lookup for anyone.
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/reset-password", validate(resetSchema), async (req, res, next) => {
  try {
    const userId = await consumeVerificationToken(req.body.token, "PASSWORD_RESET");
    // Hashing lives in authService so the bcrypt cost factor has exactly one
    // definition. A reset that hashed at a different cost than registration is
    // invisible until someone audits the table.
    const user = await resetUserPassword(userId, req.body.password);

    // Every other session dies. Someone resetting a password is often doing it
    // because another party has access, and a live 30-day refresh token would
    // hand the account straight back on its next rotation.
    await revokeAllRefreshTokens(user.id);

    // Sign them in on this device, so the flow ends at a usable app rather than
    // at a login form they must immediately fill in again.
    const refreshToken = await issueRefreshToken(user.id);
    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
    res.json({ user: toPublicUser(user), accessToken: signAccessToken(user.id) });
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

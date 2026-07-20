// Passport strategy setup for Spotify + Google OAuth.
//
// Stateless (session: false) — the callback routes mint our own JWT + refresh
// cookie, so Passport only does the provider handshake and hands back a user.
// A strategy is registered only when its client id/secret are configured, so a
// dev without OAuth keys can still run everything else; `oauthProviders` records
// which ones are live so the routes can 503 cleanly for the rest.
import passport from "passport";
import { Strategy as SpotifyStrategy } from "passport-spotify";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import type { VerifyCallback } from "passport-google-oauth20";
import { env } from "./env.js";
import { findOrCreateOAuthUser } from "../services/authService.js";

export type OAuthProvider = "spotify" | "google";

export const oauthProviders: Record<OAuthProvider, boolean> = {
  spotify: false,
  google: false,
};

if (env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET) {
  passport.use(
    new SpotifyStrategy(
      {
        clientID: env.SPOTIFY_CLIENT_ID,
        clientSecret: env.SPOTIFY_CLIENT_SECRET,
        callbackURL: env.SPOTIFY_REDIRECT_URI,
      },
      async (accessToken, refreshToken, _expires, profile, done) => {
        try {
          const user = await findOrCreateOAuthUser({
            provider: "spotify",
            providerAccountId: profile.id,
            email: profile.emails?.[0]?.value ?? null,
            displayName: profile.displayName ?? null,
            accessToken,
            refreshToken,
          });
          done(null, { id: user.id });
        } catch (err) {
          done(err as Error);
        }
      },
    ),
  );
  oauthProviders.spotify = true;
}

if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        callbackURL: env.GOOGLE_REDIRECT_URI,
      },
      async (accessToken: string, refreshToken: string, profile, done: VerifyCallback) => {
        try {
          const user = await findOrCreateOAuthUser({
            provider: "google",
            providerAccountId: profile.id,
            email: profile.emails?.[0]?.value ?? null,
            displayName: profile.displayName ?? null,
            accessToken,
            refreshToken,
          });
          done(null, { id: user.id });
        } catch (err) {
          done(err as Error);
        }
      },
    ),
  );
  oauthProviders.google = true;
}

export { passport };

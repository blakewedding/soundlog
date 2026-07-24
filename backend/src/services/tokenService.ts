// Access + refresh token issuance.
//
// Access tokens are short-lived JWTs carrying `sub = userId` (the shape
// requireAuth expects). Refresh tokens are opaque random strings; only their
// SHA-256 hash is persisted in the RefreshToken model, so a database leak never
// exposes a usable token. Refresh tokens rotate on every use: presenting one
// revokes it and mints a replacement. Re-presenting an already-revoked token is
// treated as theft and revokes the user's whole active family.
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";
import { prisma } from "../config/database.js";
import { HttpError } from "../middleware/errorHandler.js";

const REFRESH_TOKEN_BYTES = 48;

export function signAccessToken(userId: string): string {
  const options: SignOptions = { expiresIn: env.JWT_ACCESS_TTL as SignOptions["expiresIn"] };
  return jwt.sign({ sub: userId }, env.JWT_SECRET, options);
}

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function refreshExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** Mint a fresh refresh token, persist its hash, and return the raw value. */
export async function issueRefreshToken(userId: string): Promise<string> {
  const raw = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString("hex");
  await prisma.refreshToken.create({
    data: { userId, tokenHash: hashToken(raw), expiresAt: refreshExpiry() },
  });
  return raw;
}

/**
 * Validate a refresh token and rotate it. Returns the owning userId and a brand
 * new raw refresh token. Throws HttpError(401) if the token is unknown, expired,
 * or already used (the latter also revokes the user's remaining active tokens).
 */
export async function rotateRefreshToken(raw: string): Promise<{ userId: string; token: string }> {
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!existing) throw new HttpError(401, "Invalid refresh token");

  if (existing.revokedAt) {
    // A revoked token being replayed means someone kept a copy — burn the family.
    await prisma.refreshToken.updateMany({
      where: { userId: existing.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new HttpError(401, "Refresh token already used");
  }

  if (existing.expiresAt.getTime() < Date.now()) {
    throw new HttpError(401, "Refresh token expired");
  }

  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
  });
  const token = await issueRefreshToken(existing.userId);
  return { userId: existing.userId, token };
}

/** Revoke a refresh token if it is currently active. Idempotent. */
export async function revokeRefreshToken(raw: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(raw), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Revoke every active refresh token a user holds. Idempotent.
 *
 * This is what makes a password reset mean something. Someone resetting their
 * password is very often doing it BECAUSE another party has access; leaving
 * that party's 30-day refresh token alive would hand them the account back on
 * their next rotation, and the user would have no way to tell.
 */
export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

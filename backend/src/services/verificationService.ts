// Single-use, expiring tokens delivered by email.
//
// Same discipline as tokenService's refresh tokens, for the same reason: a
// password-reset token IS a credential. Only the SHA-256 hash is persisted, so
// a database leak yields nothing that can be redeemed; the raw value exists
// only in the email that carried it and in the URL the user clicks.
//
// One model with a `purpose` rather than two near-identical tables, so expiry,
// single-use and hashing have exactly one implementation — and one set of
// tests — instead of two that can drift apart.
import crypto from "node:crypto";
import { VerificationPurpose } from "@prisma/client";
import { prisma } from "../config/database.js";
import { env } from "../config/env.js";
import { HttpError } from "../middleware/errorHandler.js";

const TOKEN_BYTES = 32;

/**
 * How long each kind of link lives.
 *
 * A reset token is far more dangerous than a verification token — it grants
 * account takeover to whoever holds it — so it expires in an hour while
 * verification gets a day. Verification links are routinely clicked the next
 * morning; reset links are clicked within minutes or not at all.
 */
const TTL_MS: Record<VerificationPurpose, number> = {
  EMAIL_VERIFICATION: 24 * 60 * 60 * 1000,
  PASSWORD_RESET: 60 * 60 * 1000,
  // Between the two, and closer to the reset. An email change is a
  // security-relevant action like a reset, so it should not sit claimable for a
  // day — but unlike a reset the user is not usually standing at the keyboard
  // waiting, because the link lands in a mailbox they may have to go and open
  // on another device.
  EMAIL_CHANGE: 2 * 60 * 60 * 1000,
};

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Mint a token for `purpose` and return the RAW value (the only time it exists
 * in plaintext).
 *
 * Any outstanding token of the same purpose is consumed first: requesting a new
 * reset link must invalidate the old one, or an attacker who captured an
 * earlier email keeps a working key for as long as it had left to run.
 */
export async function issueVerificationToken(
  userId: string,
  purpose: VerificationPurpose
): Promise<string> {
  await prisma.verificationToken.updateMany({
    where: { userId, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const raw = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  await prisma.verificationToken.create({
    data: {
      userId,
      purpose,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + TTL_MS[purpose]),
    },
  });
  return raw;
}

/**
 * Redeem a token. Returns the owning userId.
 *
 * Every failure mode — unknown, wrong purpose, already used, expired — raises
 * the SAME 400 with the same message. Distinguishing them tells an attacker
 * holding a guessed token which half of the guess was right, and tells anyone
 * probing whether a given token ever existed.
 */
export async function consumeVerificationToken(
  raw: string,
  purpose: VerificationPurpose
): Promise<string> {
  const invalid = () => new HttpError(400, "This link is invalid or has expired");

  const existing = await prisma.verificationToken.findUnique({
    where: { tokenHash: hashToken(raw) },
  });
  if (!existing || existing.purpose !== purpose) throw invalid();
  if (existing.consumedAt) throw invalid();
  if (existing.expiresAt.getTime() < Date.now()) throw invalid();

  // Consume by id AND still-unconsumed, so two simultaneous clicks on the same
  // link cannot both succeed — the second updates zero rows and is rejected.
  const claimed = await prisma.verificationToken.updateMany({
    where: { id: existing.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (claimed.count === 0) throw invalid();

  return existing.userId;
}

/**
 * The absolute URL a user clicks.
 *
 * Built from CLIENT_URL — the app origin — so it is https://soundlog.app in
 * production by construction, and the token rides a path segment of the SPA
 * route rather than being invented here.
 */
export function verificationLink(path: string, token: string): string {
  const url = new URL(path, env.CLIENT_URL);
  url.searchParams.set("token", token);
  return url.toString();
}

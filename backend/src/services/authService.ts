// User creation & credential checks for email/password and OAuth sign-in.
import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";
import { prisma } from "../config/database.js";
import { HttpError } from "../middleware/errorHandler.js";
import { indexUser } from "./searchService.js";

const SALT_ROUNDS = 12;

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
}

/** Public projection of a user — never leaks the password hash. */
export function toPublicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
  };
}

export async function registerUser(input: RegisterInput): Promise<User> {
  const email = input.email.toLowerCase();
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username: input.username }] },
    select: { email: true, username: true },
  });
  if (existing) {
    const field = existing.email === email ? "email" : "username";
    throw new HttpError(409, `An account with that ${field} already exists`);
  }

  const password = await bcrypt.hash(input.password, SALT_ROUNDS);
  const user = await prisma.user.create({ data: { username: input.username, email, password } });
  await indexUser(user); // searchable as a member (Phase 5)
  return user;
}

export async function verifyCredentials(email: string, password: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  // Same error whether the email is unknown or the password is wrong — don't
  // let callers probe which emails exist. Also compare against a hash even when
  // the account is OAuth-only (no password) to blunt timing differences.
  const hash = user?.password ?? "$2a$12$0000000000000000000000000000000000000000000000000000";
  const ok = await bcrypt.compare(password, hash);
  if (!user || !user.password || !ok) throw new HttpError(401, "Invalid email or password");
  return user;
}

export interface OAuthProfile {
  provider: string;
  providerAccountId: string;
  email?: string | null;
  displayName?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
}

/**
 * Resolve an OAuth login to a User, creating the account (and possibly the user)
 * on first sign-in. Resolution order: existing OAuthAccount → existing user with
 * the same email (link) → brand-new user.
 */
export async function findOrCreateOAuthUser(profile: OAuthProfile): Promise<User> {
  const { provider, providerAccountId } = profile;

  const account = await prisma.oAuthAccount.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId } },
    include: { user: true },
  });
  if (account) {
    await prisma.oAuthAccount.update({
      where: { id: account.id },
      data: {
        accessToken: profile.accessToken ?? account.accessToken,
        refreshToken: profile.refreshToken ?? account.refreshToken,
      },
    });
    return account.user;
  }

  const email = profile.email?.toLowerCase() ?? null;
  let user = email ? await prisma.user.findUnique({ where: { email } }) : null;

  if (!user) {
    const username = await generateUniqueUsername(profile.displayName ?? email?.split("@")[0] ?? provider);
    user = await prisma.user.create({
      data: {
        username,
        // OAuth providers don't always release an email; synthesize a stable,
        // unique placeholder so the NOT NULL + unique constraint still holds.
        email: email ?? `${provider}_${providerAccountId}@users.noreply.soundlog.app`,
        displayName: profile.displayName ?? undefined,
        // password stays null — this is an OAuth-only account.
      },
    });
    await indexUser(user); // searchable as a member (Phase 5)
  }

  await prisma.oAuthAccount.create({
    data: {
      userId: user.id,
      provider,
      providerAccountId,
      accessToken: profile.accessToken ?? undefined,
      refreshToken: profile.refreshToken ?? undefined,
    },
  });
  return user;
}

/** Slugify a seed into a valid, currently-unused username (3–24 chars). */
async function generateUniqueUsername(seed: string): Promise<string> {
  let base = seed.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
  if (base.length < 3) base = `${base}listener`.slice(0, 20);

  let candidate = base;
  let suffix = 0;
  while (await prisma.user.findUnique({ where: { username: candidate }, select: { id: true } })) {
    suffix += 1;
    candidate = `${base.slice(0, 20 - String(suffix).length)}${suffix}`;
  }
  return candidate;
}

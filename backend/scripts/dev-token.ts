// Mint a local dev access token, for exercising authenticated endpoints from a
// client that has no sign-in yet — the Expo app on a real device, above all.
//
// Run from backend/:
//   npx tsx scripts/dev-token.ts                  # demo_blake, 12h
//   npx tsx scripts/dev-token.ts sasha 1h         # another user, shorter TTL
//
// Prints ONLY the token to stdout (progress goes to stderr), so it composes:
//   EXPO_PUBLIC_DEV_TOKEN=$(cd backend && npx tsx scripts/dev-token.ts) \
//     pnpm --filter @soundlog/mobile dev
//
// The default TTL is deliberately longer than the 15-minute production access
// token: a device testing session outlives 15 minutes, and re-minting mid-test
// looks exactly like an auth bug. This signs the same `{ sub: userId }` payload
// with the same JWT_SECRET as signAccessToken, so it is a real token — it is
// only usable against a local dev server holding the local secret.
import "dotenv/config";
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { env } from "../src/config/env.js";

const username = process.argv[2] ?? "demo_blake";
const ttl = process.argv[3] ?? "12h";

async function main() {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { username },
      select: { id: true, username: true },
    });

    if (!user) {
      const all = await prisma.user.findMany({ select: { username: true } });
      console.error(
        `No user "${username}". Known users: ${all.map((u) => u.username).join(", ") || "(none — seed the DB first)"}`
      );
      process.exit(1);
    }

    const options: SignOptions = { expiresIn: ttl as SignOptions["expiresIn"] };
    const token = jwt.sign({ sub: user.id }, env.JWT_SECRET, options);

    console.error(`Access token for ${user.username}, valid ${ttl}:`);
    process.stdout.write(token);
    console.error("");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

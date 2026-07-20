// Manual live smoke test against the REAL MusicBrainz API (rate-limited).
// Run from backend/:  npx tsx scripts/mb-smoke.ts
//
// Wraps global fetch to log the outbound User-Agent header on the first
// musicbrainz.org request, so you can confirm the configured identity
// (MUSICBRAINZ_USER_AGENT) is what's actually being sent.
import { env } from "../src/config/env.js";
import { redis } from "../src/config/redis.js";
import {
  searchReleaseGroups,
  lookupReleaseGroup,
  getCoverArtUrls,
  creditsOf,
} from "../src/services/musicbrainzService.js";

const QUERY = "radiohead in rainbows";

// Log the User-Agent actually sent on the first MB request.
let logged = false;
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();
  if (!logged && url.includes("musicbrainz.org")) {
    const headers = new Headers(init?.headers);
    console.log("→ outbound User-Agent:", headers.get("User-Agent"));
    logged = true;
  }
  return realFetch(input, init);
}) as typeof fetch;

async function main() {
  console.log("Configured MUSICBRAINZ_USER_AGENT:", env.MUSICBRAINZ_USER_AGENT);

  // Clear caches so this run makes genuine, rate-limited network calls.
  await redis.del(`mb:rg:search:${QUERY.toLowerCase()}`);

  console.log(`\n1) release-group search: "${QUERY}"`);
  const groups = await searchReleaseGroups(QUERY);
  const top = groups[0];
  if (!top) {
    console.log("   no results — is the network up?");
    await redis.quit();
    return;
  }
  const { artistName } = creditsOf(top);
  console.log(`   top hit: ${artistName} — ${top.title}  [${top["primary-type"]}]  ${top.id}`);

  await redis.del(`mb:rg:${top.id}`);
  console.log("\n2) release-group lookup by MBID");
  const detail = await lookupReleaseGroup(top.id);
  console.log(`   title: ${detail?.title}  first-release: ${detail?.["first-release-date"]}`);

  await redis.del(`caa:rg:urls:${top.id}`);
  console.log("\n3) Cover Art Archive by MBID");
  const cover = await getCoverArtUrls(top.id);
  console.log(`   thumb: ${cover?.thumb ?? "(none on file)"}`);
  console.log(`   large: ${cover?.large ?? "(none on file)"}`);

  console.log("\nDone. Requests were spaced ≥1.1s apart by the shared throttle.");
  await redis.quit();
}

main().catch(async (err) => {
  console.error("smoke failed:", err);
  await redis.quit().catch(() => {});
  process.exit(1);
});

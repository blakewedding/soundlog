// Phase 5.8 — healing releases duplicated by a leaked Discogs disambiguation
// suffix ("Danny Brown (2)"). The merge must fold the duplicate into the
// MusicBrainz-anchored canonical row while preserving user data, including the
// hard case where the SAME user rated both rows (a unique-constraint collision).
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import {
  healDiscogsSuffixDuplicates,
  deleteReleaseEverywhere,
} from "../../src/services/catalogService.js";
import { runTag } from "../support/runTag.js";

const RUN = runTag();
const TITLE = `Atrocity Exhibition ${RUN}`;
const DOMAIN = `p58heal-${RUN}.local`;

let canonicalId: string;
let dupeId: string;
let artistId: string;
let raterId: string;
let onlyDupeRaterId: string;

async function makeUser(tag: string): Promise<string> {
  const u = await prisma.user.create({
    data: { username: `${tag}_${RUN}`, email: `${tag}_${RUN}@${DOMAIN}`, password: "x" },
  });
  return u.id;
}

beforeEach(async () => {
  const artist = await prisma.artist.create({
    data: { musicbrainzId: `mb-artist-${RUN}`, name: "Danny Brown" },
  });
  artistId = artist.id;

  // Canonical: MusicBrainz-anchored, clean name, real artist link.
  const canonical = await prisma.release.create({
    data: {
      title: TITLE,
      artistName: "Danny Brown",
      artistId,
      musicbrainzId: `mb-rel-${RUN}`,
      type: "ALBUM",
      genres: [],
    },
  });
  canonicalId = canonical.id;

  // Duplicate: Discogs-seeded, suffix leaked into the name, no artist link.
  const dupe = await prisma.release.create({
    data: {
      title: TITLE,
      artistName: "Danny Brown (2)",
      discogsId: `release:${RUN}`,
      type: "ALBUM",
      genres: [],
    },
  });
  dupeId = dupe.id;

  raterId = await makeUser("both"); // rates BOTH → collision
  onlyDupeRaterId = await makeUser("dupeonly"); // rates only the duplicate

  await prisma.rating.createMany({
    data: [
      { userId: raterId, releaseId: canonicalId, value: 4.5 },
      { userId: raterId, releaseId: dupeId, value: 4.5 }, // the collision
      { userId: onlyDupeRaterId, releaseId: dupeId, value: 3 }, // must survive on the winner
    ],
  });
  await prisma.log.create({ data: { userId: raterId, releaseId: dupeId } });
});

afterEach(async () => {
  for (const id of [canonicalId, dupeId]) {
    await deleteReleaseEverywhere(id).catch(() => {});
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
  await prisma.artist.deleteMany({ where: { musicbrainzId: `mb-artist-${RUN}` } });
});

afterAll(async () => {
  await prisma.$disconnect();
  await redis.quit();
});

describe("healDiscogsSuffixDuplicates", () => {
  it("folds the suffixed duplicate into the MusicBrainz-anchored canonical row", async () => {
    const healed = await healDiscogsSuffixDuplicates();
    const mine = healed.find((h) => h.title === TITLE);
    expect(mine, "the suffix duplicate should be healed").toBeDefined();
    expect(mine!.winnerId).toBe(canonicalId); // MB row wins
    expect(mine!.mergedLoserIds).toContain(dupeId);

    // The duplicate row is gone; the canonical remains, name cleaned.
    expect(await prisma.release.findUnique({ where: { id: dupeId } })).toBeNull();
    const winner = await prisma.release.findUnique({ where: { id: canonicalId } });
    expect(winner!.artistName).toBe("Danny Brown");
    // The winner absorbed the loser's Discogs id.
    expect(winner!.discogsId).toBe(`release:${RUN}`);
  });

  it("preserves user data: keeps the winner's rating on collision, moves the unique one", async () => {
    await healDiscogsSuffixDuplicates();

    const ratings = await prisma.rating.findMany({ where: { releaseId: canonicalId } });
    // Collider counted once; the dupe-only rater moved over → two ratings total.
    expect(ratings).toHaveLength(2);
    expect(ratings.filter((r) => r.userId === raterId)).toHaveLength(1);
    expect(ratings.find((r) => r.userId === onlyDupeRaterId)?.value).toBe(3);

    // The log followed the release.
    const logs = await prisma.log.findMany({ where: { releaseId: canonicalId } });
    expect(logs.some((l) => l.userId === raterId)).toBe(true);

    // No rating left stranded on the deleted duplicate.
    expect(await prisma.rating.count({ where: { releaseId: dupeId } })).toBe(0);
  });

  it("is idempotent — a second run finds nothing to heal", async () => {
    await healDiscogsSuffixDuplicates();
    const second = await healDiscogsSuffixDuplicates();
    expect(second.find((h) => h.title === TITLE)).toBeUndefined();
  });
});

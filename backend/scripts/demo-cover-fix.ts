/**
 * 6.3 live demo — resolve the real defective releases through the FIXED code,
 * against the live Cover Art Archive / MusicBrainz / Discogs. Read-only: it
 * resolves and prints, and writes nothing to Postgres.
 *
 *   npx tsx scripts/demo-cover-fix.ts
 */
import { getCoverArtUrls } from "../src/services/musicbrainzService.js";
import { findDiscogsCover } from "../src/services/discogsService.js";
import { redis } from "../src/config/redis.js";

// Release-group MBIDs as stored in production's Release.musicbrainzId.
const CASES: Array<{ title: string; mbid: string; symptom: string }> = [
  { title: "Small Change", mbid: "74d9eef1-bbc6-3029-8289-a53ef41698f6", symptom: "showed Asylum side-one LABEL scan" },
  { title: "Blue Valentine", mbid: "a138f035-a018-3d29-8b90-36b30956fccc", symptom: "blank (group endpoint 500s)" },
  { title: "Swordfishtrombones", mbid: "c791b365-0400-3926-be67-d1d9c71fc37e", symptom: "blank (group endpoint 500s)" },
  { title: "One From the Heart", mbid: "69393ad0-ada7-39e3-b3ef-97bf4acbff4c", symptom: "blank (cache had the art)" },
  { title: "Downtown Train", mbid: "ac9496d6-a9af-443a-80ff-e45e7bd45bed", symptom: "blank (group endpoint 500s)" },
  { title: "Heartattack and Vine", mbid: "6a9906e1-1ab2-37e1-980b-5e4889661089", symptom: "blank" },
];

async function main() {
  for (const c of CASES) {
    // Bypass any cached answer so this demonstrates the resolver, not Redis.
    await redis.del(`caa:rg:urls:${c.mbid}`);
    let line: string;
    try {
      const urls = await getCoverArtUrls(c.mbid, "interactive");
      line = urls ? `RESOLVED ${urls.thumb}` : "no approved front on CAA";
    } catch (err) {
      line = `RETRY-ABLE (${(err as Error).name}) — correctly NOT cached as 'no art'`;
    }
    console.log(`\n${c.title}\n  was: ${c.symptom}\n  now: ${line}`);
  }

  // The Discogs half: the selector that produced the label scan.
  const discogs = await findDiscogsCover("Tom Waits", "Small Change");
  console.log(`\nDiscogs fallback for Small Change:\n  ${discogs}`);

  await redis.quit();
}

main().catch(async (e) => {
  console.error(e);
  await redis.quit();
  process.exit(1);
});

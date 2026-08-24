// READ-ONLY: poll a discography assembly exactly as the client does (1.2s), and
// report which terminal state it reaches. Answers "did the watchdog fire?".
import { redis } from "../src/config/redis.js";
import { getDiscographyState } from "../src/services/discographyService.js";
import { invalidateCached } from "../src/services/cache.js";
import { discographyCacheKey } from "../src/services/musicbrainzService.js";

const DYLAN = "72c536dc-7137-4477-a521-567eeb840fa8";
const started = Date.now();
const el = () => ((Date.now() - started) / 1000).toFixed(1).padStart(6);

async function main() {
  await redis.connect().catch(() => {});
  const key = discographyCacheKey(DYLAN);
  console.log(`cache key ${key}`);
  console.log(`cached before: ${(await redis.get(key)) ? "PRESENT — clearing for a cold run" : "<miss>"}`);
  await invalidateCached(key); // regenerable derivative; a cold run is the point

  let lastFetched = -1;
  let unchangedSince = Date.now();
  for (let poll = 0; poll < 400; poll++) {
    try {
      const state = await getDiscographyState(DYLAN);
      if (state.status === "complete") {
        console.log(`${el()}s  COMPLETE — ${state.entries.length} entries`);
        break;
      }
      const { fetched, total } = state.progress;
      if (fetched !== lastFetched) {
        const pct = total ? Math.round((fetched / total) * 100) : null;
        console.log(`${el()}s  assembling ${fetched}${total ? `/${total}` : ""}${pct !== null ? ` (${pct}%)` : ""}`);
        lastFetched = fetched;
        unchangedSince = Date.now();
      } else if (Date.now() - unchangedSince > 20_000) {
        console.log(`${el()}s  …no progress for ${((Date.now() - unchangedSince) / 1000).toFixed(0)}s (watchdog at 90s)`);
        unchangedSince = Date.now();
      }
    } catch (err) {
      console.log(`${el()}s  THREW ${(err as Error).name}: ${(err as Error).message.slice(0, 140)}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 1200)); // the client's poll interval
  }
  await redis.quit().catch(() => {});
}
main().catch((e) => { console.error(e); process.exit(1); });

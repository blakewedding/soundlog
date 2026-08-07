import { createApp } from "./app.js";
import { env, warnIfInsecureOrigin } from "./config/env.js";
import { ensureIndices } from "./config/elasticsearch.js";
import { redis } from "./config/redis.js";
import { startActivityWorker } from "./jobs/activityQueue.js";
import { startPrewarming } from "./services/prewarmService.js";
import { startWarming } from "./services/warmService.js";
import { primeGenreVocabulary } from "./services/genreVocabulary.js";
import { assertSingleApiInstance } from "./config/singleInstance.js";

async function main() {
  warnIfInsecureOrigin();
  assertSingleApiInstance();
  try { await redis.connect(); } catch { console.warn("[boot] Redis unavailable — continuing"); }
  try { await ensureIndices(); } catch { console.warn("[boot] Elasticsearch unavailable — continuing"); }

  try {
    startActivityWorker();
    console.log("[boot] Activity worker started");
  } catch (err) {
    console.warn("[boot] Activity worker failed to start:", (err as Error).message);
  }

  startPrewarming();
  startWarming();
  // Fire-and-forget: the bundled snapshot already serves, so nothing waits on
  // this. Explicit at boot rather than lazily from the read path, so enriching
  // one release can never quietly become a 22-page walk.
  void primeGenreVocabulary();

  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`Soundlog API listening on :${env.PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

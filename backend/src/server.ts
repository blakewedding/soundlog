import { createApp } from "./app.js";
import { env, warnIfInsecureOrigin } from "./config/env.js";
import { ensureIndices } from "./config/elasticsearch.js";
import { redis } from "./config/redis.js";
import { startActivityWorker } from "./jobs/activityQueue.js";
import { startPrewarming } from "./services/prewarmService.js";
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

  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`Soundlog API listening on :${env.PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

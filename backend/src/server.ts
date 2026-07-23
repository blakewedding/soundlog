import { createApp } from "./app.js";
import { env, warnIfInsecureOrigin } from "./config/env.js";
import { ensureIndices } from "./config/elasticsearch.js";
import { redis } from "./config/redis.js";
import { startActivityWorker } from "./jobs/activityQueue.js";

async function main() {
  warnIfInsecureOrigin();
  try { await redis.connect(); } catch { console.warn("[boot] Redis unavailable — continuing"); }
  try { await ensureIndices(); } catch { console.warn("[boot] Elasticsearch unavailable — continuing"); }

  try {
    startActivityWorker();
    console.log("[boot] Activity worker started");
  } catch (err) {
    console.warn("[boot] Activity worker failed to start:", (err as Error).message);
  }

  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`Soundlog API listening on :${env.PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

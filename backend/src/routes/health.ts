import { Router } from "express";
import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";
import { es } from "../config/elasticsearch.js";
import { coverArtGate, starvationStats } from "../services/upstreamPriority.js";
import { mbGateStats } from "../services/musicbrainzService.js";
import { mbTelemetry } from "../services/upstreamTelemetry.js";
import { assemblyStats } from "../services/discographyService.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  const checks: Record<string, string> = {};
  try { await prisma.$queryRaw`SELECT 1`; checks.postgres = "ok"; } catch { checks.postgres = "down"; }
  try { await redis.ping(); checks.redis = "ok"; } catch { checks.redis = "down"; }
  try { await es.ping(); checks.elasticsearch = "ok"; } catch { checks.elasticsearch = "down"; }
  const healthy = Object.values(checks).every((v) => v === "ok");
  res.status(healthy ? 200 : 503).json({ status: healthy ? "ok" : "degraded", checks });
});

/**
 * Upstream saturation, as a probe can see it.
 *
 * Separate from `/` on purpose: the liveness probe must stay a cheap three-ping
 * check, while this is the diagnostic one. It exists because of 6.3e — a wedged
 * `browse` assembly was invisible to every signal we had. Postgres, Redis and
 * Elasticsearch were all "ok" the whole time, so the probe above would have
 * reported perfect health while artist pages hung.
 *
 * `oldestWaitMs` and `oldestAgeMs` are the load-bearing fields. Queue DEPTH says
 * how busy we are; AGE says whether anything is stuck, and only age can tell a
 * fast-draining queue of forty from one waiter that has been parked for minutes.
 */
healthRouter.get("/upstream", (_req, res) => {
  const assemblies = assemblyStats();
  const mb = mbGateStats();
  const starvation = starvationStats();

  // Deliberately not a hard failure: this endpoint reports, and alerting decides.
  // A 503 here would take the container out of rotation for being BUSY, which
  // would make a saturation problem into an availability one.
  res.json({
    status: "ok",
    musicbrainz: mb,
    coverArt: coverArtGate.stats(),
    discographyAssemblies: assemblies,
    starvation,
    // What we ACTUALLY asked MusicBrainz and what it actually said (6.3e
    // follow-up #1). `observedGap` is the compliance evidence; `retryableRate`
    // is the number the 54% has to be re-measured against now that the fused
    // artist credits are no longer generating queries of their own.
    musicbrainzTelemetry: mbTelemetry.snapshot(),
  });
});

import { Router } from "express";
import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";
import { es } from "../config/elasticsearch.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  const checks: Record<string, string> = {};
  try { await prisma.$queryRaw`SELECT 1`; checks.postgres = "ok"; } catch { checks.postgres = "down"; }
  try { await redis.ping(); checks.redis = "ok"; } catch { checks.redis = "down"; }
  try { await es.ping(); checks.elasticsearch = "ok"; } catch { checks.elasticsearch = "down"; }
  const healthy = Object.values(checks).every((v) => v === "ok");
  res.status(healthy ? 200 : 503).json({ status: healthy ? "ok" : "degraded", checks });
});

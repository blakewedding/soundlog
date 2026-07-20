// Activity fan-out. Every social event (log, review, rating, list, comment,
// follow) records an Activity row for the actor; the feed reads those across a
// viewer's followees (fan-out on read). Recording is offloaded to a BullMQ job
// so it never blocks — or breaks — the request that triggered it.
//
// In tests we record synchronously for determinism (no worker timing); a
// dedicated test exercises the real queue → worker → recordActivity path.
import { Queue, Worker, type Job } from "bullmq";
import type { ActivityType } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../config/database.js";

// BullMQ disallows ":" in queue names (it's the Redis key separator).
export const ACTIVITY_QUEUE = "soundlog-activity";

export interface ActivityJob {
  userId: string;
  type: ActivityType;
  targetId: string;
}

// Pass connection *options* (not an ioredis instance) so BullMQ builds its own
// client with the settings it needs (maxRetriesPerRequest: null) — this also
// dodges the ioredis version skew between bullmq and our own dependency.
export function bullConnection() {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    ...(url.username ? { username: url.username } : {}),
    ...(url.password ? { password: url.password } : {}),
    maxRetriesPerRequest: null,
  };
}

function createQueue() {
  return new Queue<ActivityJob>(ACTIVITY_QUEUE, { connection: bullConnection() });
}

let queue: ReturnType<typeof createQueue> | null = null;
function activityQueue() {
  queue ??= createQueue();
  return queue;
}

/** The unit of work: persist one Activity row. Shared by the worker and tests. */
export async function recordActivity(job: ActivityJob): Promise<void> {
  await prisma.activity.create({
    data: { userId: job.userId, type: job.type, targetId: job.targetId },
  });
}

/**
 * Emit a social event. Async fan-out via BullMQ in normal runs; synchronous in
 * tests. Never throws into the caller — a broken queue must not fail a listen
 * log or a review.
 */
export async function emitActivity(job: ActivityJob): Promise<void> {
  if (env.NODE_ENV === "test") {
    await recordActivity(job);
    return;
  }
  try {
    await activityQueue().add("activity", job, {
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
    });
  } catch (err) {
    console.warn("[activity] enqueue failed:", (err as Error).message);
  }
}

/** Start the in-process worker that drains the activity queue. Called at boot. */
export function startActivityWorker() {
  const worker = new Worker<ActivityJob>(
    ACTIVITY_QUEUE,
    async (job: Job<ActivityJob>) => recordActivity(job.data),
    { connection: bullConnection() }
  );
  worker.on("failed", (job, err) => console.error("[activity] job failed:", job?.id, err.message));
  return worker;
}

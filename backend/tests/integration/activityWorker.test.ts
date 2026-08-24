// Proves the real BullMQ path: a job enqueued to a Queue is picked up by a
// Worker whose processor is recordActivity (exactly what startActivityWorker
// wires), and an Activity row is written. Uses a unique queue name so it can't
// interfere with any other worker on the shared Redis.
import { describe, it, expect, afterAll } from "vitest";
import { Queue, Worker, type Job } from "bullmq";
import { prisma } from "../../src/config/database.js";
import { redis } from "../../src/config/redis.js";
import { bullConnection, recordActivity, type ActivityJob } from "../../src/jobs/activityQueue.js";
import { runTag } from "../support/runTag.js";

const RUN = runTag();
const QUEUE = `test-activity-${RUN}`; // BullMQ forbids ":" in queue names

let userId: string;
const queue = new Queue<ActivityJob>(QUEUE, { connection: bullConnection() });
const worker = new Worker<ActivityJob>(QUEUE, async (job: Job<ActivityJob>) => recordActivity(job.data), {
  connection: bullConnection(),
});

afterAll(async () => {
  await worker.close();
  await queue.obliterate({ force: true }).catch(() => {});
  await queue.close();
  if (userId) await prisma.user.deleteMany({ where: { id: userId } }); // cascades Activity
  await prisma.$disconnect();
  await redis.quit();
});

describe("BullMQ activity worker", () => {
  it("processes an enqueued job into an Activity row", async () => {
    const user = await prisma.user.create({
      data: { username: `worker_${RUN}`, email: `worker_${RUN}@p4test.local`, password: "x" },
    });
    userId = user.id;

    await queue.add("activity", { userId, type: "LOG", targetId: `rel-${RUN}` });

    // Wait for the worker to drain the job.
    //
    // "BullMQ is near-instant" is true on an idle box and was the assumption
    // baked into the old 5s budget (50 x 100ms). Inside the full suite — 500+
    // tests contending for the same Redis and Postgres — it is not, and this
    // failed once in a full run while passing in isolation every time.
    //
    // The budget is raised rather than the assertion relaxed: the test still
    // demands that the row appear and match exactly. All that changes is how
    // long it is willing to wait for a loaded machine, which is not a property
    // of the code under test. The vitest timeout below is raised in step, or
    // the poll can outlive the test and report as a timeout instead of a
    // failure.
    let activity = null;
    for (let i = 0; i < 200 && !activity; i++) {
      activity = await prisma.activity.findFirst({ where: { userId } });
      if (!activity) await new Promise((r) => setTimeout(r, 100));
    }
    expect(activity, "worker should have recorded the activity").not.toBeNull();
    expect(activity).toMatchObject({ type: "LOG", targetId: `rel-${RUN}` });
  }, 30_000);
});

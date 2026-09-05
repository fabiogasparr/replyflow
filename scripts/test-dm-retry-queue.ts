/**
 * Real Redis checks for manual retry job idempotency. Uses a unique BullMQ
 * queue and removes it in finally, so development jobs are never touched.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { Queue } from "bullmq";
import Redis from "ioredis";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
config({
  path: [path.join(projectRoot, ".env.local"), path.join(projectRoot, ".env")],
  quiet: true,
});

function redisUrl() {
  const value = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;
  if (!value) throw new Error("Defina TEST_REDIS_URL para um Redis local.");
  const url = new URL(value);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("O teste de reprocessamento aceita somente Redis em localhost.");
  }
  return value;
}

async function main() {
  const queueName = `replyflow-dm-retry-test-${randomBytes(8).toString("hex")}`;
  const connection = new Redis(redisUrl(), { maxRetriesPerRequest: null });
  const queue = new Queue(queueName, { connection });
  try {
    await queue.waitUntilReady();
    const firstJobId = "manual_retry_log_1_1";
    const jobData = {
      automationId: "automation_1",
      instagramAccountId: "business_1",
      commentId: "comment_1",
      commentText: "quero",
      commenterId: "person_1",
      matchedKeyword: "quero",
      mediaId: "media_1",
      source: "MANUAL",
    };

    await Promise.all(
      Array.from({ length: 20 }, () =>
        queue.add("process-comment", jobData, { jobId: firstJobId })
      )
    );
    assert.equal(
      await queue.getJobCountByTypes("wait", "delayed", "active"),
      1,
      "Chamadas concorrentes com a mesma reserva devem produzir um único job."
    );
    assert.deepEqual((await queue.getJob(firstJobId))?.data, jobData);

    await queue.add("process-comment", jobData, {
      jobId: "manual_retry_log_1_2",
    });
    assert.equal(await queue.getJobCountByTypes("wait"), 2);
    console.log("✓ Redis deduplica o mesmo contador e aceita um reprocessamento posterior");
  } finally {
    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close();
    await connection.quit();
  }
}

main().catch((error: unknown) => {
  console.error("Falha no teste Redis de reprocessamento:", error);
  process.exitCode = 1;
});

import { Worker } from "bullmq";
import prisma from "../config/prisma.js";
import logger from "../config/logger.js";
import { QUEUES, connection, maintenanceQueue } from "../config/queue.js";
import { langchainService } from "../services/ai.services.js";
import WhatsAppService from "../services/whatsapp.services.js";
import UserService from "../services/user.service.js";
import { execute, expireStale } from "../services/payment-intent.service.js";
import { processPsbWebhook } from "./psb-webhook.job.js";
import { runReconciliation } from "./reconcile.job.js";
import { withLock } from "../utils/lock.js";

// One user's messages and payments are processed strictly one at a time
// (per-user lock), so balance/limit checks can't race each other.

export async function startWorkers() {
  const workers = [
    new Worker(
      QUEUES.WHATSAPP_INBOUND,
      async (job) => {
        const { from, message, profileName } = job.data;
        try {
          await withLock(`lock:user:${from}`, () => langchainService.handleWhatsAppMessage({ from, message, profileName }));
        } catch (err) {
          logger.error(`[WORKER] inbound message failed: ${err.message}`);
          await WhatsAppService.sendMessage(from, "Sorry, something went wrong. Please try again.");
        }
      },
      { connection, concurrency: 10 },
    ),

    new Worker(
      QUEUES.PAYMENTS,
      async (job) => {
        const intent = await prisma.paymentIntent.findUnique({ where: { id: job.data.intentId }, select: { userId: true } });
        if (!intent) return;
        await withLock(`lock:pay:${intent.userId}`, () => execute(job.data.intentId), { ttlMs: 120_000, waitMs: 120_000 });
      },
      { connection, concurrency: 5 },
    ),

    new Worker(QUEUES.PSB_WEBHOOK, (job) => processPsbWebhook(job.data), { connection, concurrency: 5 }),

    new Worker(
      QUEUES.MAINTENANCE,
      async (job) => {
        switch (job.name) {
          case "create-wallet":
            return UserService.createWalletForUser(job.data.userId, { finalAttempt: job.attemptsMade + 1 >= (job.opts.attempts || 1) });
          case "reconcile":
            return runReconciliation();
          case "expire-intents":
            return expireStale();
          default:
            logger.warn(`[WORKER] unknown maintenance job ${job.name}`);
        }
      },
      { connection, concurrency: 2 },
    ),
  ];

  for (const w of workers) {
    w.on("failed", (job, err) => logger.error(`[WORKER] ${w.name}/${job?.name} failed: ${err.message}`));
  }

  await maintenanceQueue.upsertJobScheduler("reconcile", { every: 5 * 60_000 }, { name: "reconcile" });
  await maintenanceQueue.upsertJobScheduler("expire-intents", { every: 5 * 60_000 }, { name: "expire-intents" });

  logger.info("[WORKER] workers started");
  return workers;
}

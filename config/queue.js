import { Queue } from "bullmq";
import IORedis from "ioredis";
import config from "./env.js";

// BullMQ needs its own ioredis connection with retries disabled per request.
export const connection = new IORedis(config.redis.url, { maxRetriesPerRequest: null });

export const QUEUES = {
  WHATSAPP_INBOUND: "whatsapp-inbound",
  PAYMENTS: "payments",
  PSB_WEBHOOK: "psb-webhook",
  MAINTENANCE: "maintenance",
};

const make = (name) => new Queue(name, { connection });

export const whatsappInboundQueue = make(QUEUES.WHATSAPP_INBOUND);
export const paymentsQueue = make(QUEUES.PAYMENTS);
export const psbWebhookQueue = make(QUEUES.PSB_WEBHOOK);
export const maintenanceQueue = make(QUEUES.MAINTENANCE);

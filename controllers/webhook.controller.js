import logger from "../config/logger.js";
import { psbWebhookQueue } from "../config/queue.js";
import { sha256 } from "../utils/crypto.js";

// 9PSB webhook (Basic-auth protected). Acknowledge immediately and process in a
// durable job. The job id is derived from the event, so 9PSB retries are no-ops.
export async function handle9psbWebhook(req, res) {
  const payload = req.body || {};
  const eventKey =
    payload.transactionReference || payload.sessionID || payload.sessionId || payload.reference || sha256(JSON.stringify(payload));

  try {
    await psbWebhookQueue.add("event", payload, {
      jobId: `psb-${sha256(String(eventKey)).slice(0, 40)}`,
      attempts: 5,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: 5000,
      removeOnFail: 5000,
    });
  } catch (err) {
    // Not acknowledging lets 9PSB retry later rather than losing the event.
    logger.error(`[PSB WEBHOOK] enqueue failed: ${err.message}`);
    return res.status(503).json({ success: false, status: "error", code: "96", message: "Try again" });
  }

  return res.json({ success: true, status: "success", code: "00", message: "Acknowledged" });
}

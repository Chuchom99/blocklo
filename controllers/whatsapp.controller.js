import config from "../config/env.js";
import logger from "../config/logger.js";
import redis from "../config/redis.js";
import { whatsappInboundQueue } from "../config/queue.js";
import WhatsAppService from "../services/whatsapp.services.js";
import { FlowTokenError, handleFlowRequest } from "../services/flow.service.js";
import { safeEqual } from "../utils/crypto.js";
import { normalizeMsisdn } from "../utils/phone.js";

class WhatsAppController {
  static verifyWebhook(req, res) {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    if (mode === "subscribe" && safeEqual(token, config.whatsapp.verifyToken)) {
      return res.type("text/plain").send(String(req.query["hub.challenge"] ?? ""));
    }
    return res.sendStatus(403);
  }

  // Signature already verified by middleware. Ack fast; Meta retries slow webhooks,
  // which used to replay transfers. Each message id is processed at most once.
  static async handleWebhook(req, res) {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];

    if (msg?.id && msg?.from) {
      const fresh = await redis.set(`wa:msg:${msg.id}`, "1", { NX: true, EX: 86400 });
      if (fresh) {
        await whatsappInboundQueue.add(
          "message",
          { from: normalizeMsisdn(msg.from), message: msg, profileName: value.contacts?.[0]?.profile?.name },
          { jobId: `wa-${msg.id}`, attempts: 1, removeOnComplete: 1000, removeOnFail: 5000 },
        );
      } else {
        logger.info(`[WhatsApp] duplicate delivery ${msg.id} ignored`);
      }
    }
    return res.sendStatus(200);
  }

  // WhatsApp Flows data endpoint. Status codes follow Meta's spec:
  // 421 = can't decrypt (client refreshes key), 427 = invalid flow token, 432 = bad signature.
  static async handleFlow(req, res) {
    const { encrypted_flow_data, encrypted_aes_key, initial_vector } = req.body || {};
    if (!encrypted_flow_data || !encrypted_aes_key || !initial_vector) return res.sendStatus(400);

    let decrypted;
    try {
      decrypted = WhatsAppService.decryptFlowRequest({ encrypted_flow_data, encrypted_aes_key, initial_vector });
    } catch (err) {
      logger.warn(`[Flow] decryption failed: ${err.message}`);
      return res.sendStatus(421);
    }

    try {
      const response = await handleFlowRequest(decrypted.body);
      return res
        .type("text/plain")
        .send(WhatsAppService.encryptFlowResponse(response, decrypted.aesKey, decrypted.iv));
    } catch (err) {
      if (err instanceof FlowTokenError) {
        logger.warn(`[Flow] rejected token: ${err.message}`);
        return res.sendStatus(427);
      }
      throw err;
    }
  }
}

export default WhatsAppController;

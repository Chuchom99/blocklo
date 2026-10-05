import axios from "axios";
import crypto from "crypto";
import fs from "fs";
import config from "../config/env.js";
import logger from "../config/logger.js";
import { normalizeMsisdn } from "../utils/phone.js";

const { graphUrl, phoneNumberId, accessToken } = config.whatsapp;
const authHeaders = () => ({ Authorization: `Bearer ${accessToken}` });

let privateKey;
function flowPrivateKey() {
  if (!privateKey) {
    const { flowPrivateKeyPath, flowPrivateKeyPassphrase } = config.whatsapp;
    if (!flowPrivateKeyPath) throw new Error("WHATSAPP_FLOW_PRIVATE_KEY_PATH is not set");
    privateKey = crypto.createPrivateKey({
      key: fs.readFileSync(flowPrivateKeyPath, "utf8"),
      ...(flowPrivateKeyPassphrase && { passphrase: flowPrivateKeyPassphrase }),
    });
  }
  return privateKey;
}

// Meta's AES key is 128-bit per the Flows spec; accept 256-bit too.
const gcmFor = (key) => (key.length === 16 ? "aes-128-gcm" : "aes-256-gcm");

class WhatsAppService {
  // === WhatsApp Flows endpoint encryption (developers.facebook.com/docs/whatsapp/flows) ===

  static decryptFlowRequest({ encrypted_flow_data, encrypted_aes_key, initial_vector }) {
    const aesKey = crypto.privateDecrypt(
      { key: flowPrivateKey(), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      Buffer.from(encrypted_aes_key, "base64"),
    );
    if (![16, 32].includes(aesKey.length)) throw new Error("Invalid Flow AES key length");

    const iv = Buffer.from(initial_vector, "base64");
    const data = Buffer.from(encrypted_flow_data, "base64");
    const decipher = crypto.createDecipheriv(gcmFor(aesKey), aesKey, iv);
    decipher.setAuthTag(data.subarray(-16));
    const plaintext = Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]);

    return { body: JSON.parse(plaintext.toString("utf8")), aesKey, iv };
  }

  // Responses are encrypted with the same key and the bitwise-inverted IV.
  static encryptFlowResponse(response, aesKey, iv) {
    const flippedIv = Buffer.from(iv.map((b) => ~b & 0xff));
    const cipher = crypto.createCipheriv(gcmFor(aesKey), aesKey, flippedIv);
    return Buffer.concat([
      cipher.update(JSON.stringify(response), "utf8"),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString("base64");
  }

  // === Outbound messages ===

  static async post(payload, attempts = 3) {
    for (let i = 1; i <= attempts; i++) {
      try {
        await axios.post(
          `${graphUrl}/${phoneNumberId}/messages`,
          { messaging_product: "whatsapp", ...payload },
          { headers: { ...authHeaders(), "Content-Type": "application/json" }, timeout: 10000 },
        );
        return true;
      } catch (err) {
        const status = err.response?.status;
        // 4xx (other than rate limiting) won't succeed on retry.
        if (i === attempts || (status && status < 500 && status !== 429)) {
          logger.error(`[WhatsApp] send ${payload.type} failed [${status || err.code}]`);
          return false;
        }
        await new Promise((r) => setTimeout(r, 1000 * i));
      }
    }
    return false;
  }

  static sendMessage(to, text) {
    return this.post({ to: normalizeMsisdn(to), type: "text", text: { body: String(text).slice(0, 4096) } });
  }

  static async sendInteractive(to, interactive) {
    const ok = await this.post({ to: normalizeMsisdn(to), type: "interactive", interactive });
    if (!ok && interactive?.body?.text) await this.sendMessage(to, interactive.body.text);
    return ok;
  }

  static sendButtons(to, text, buttons) {
    return this.sendInteractive(to, {
      type: "button",
      body: { text },
      action: { buttons: buttons.slice(0, 3).map(({ id, title }) => ({ type: "reply", reply: { id, title: title.slice(0, 20) } })) },
    });
  }

  // Endpoint-powered Flow: Meta calls our /flow endpoint (INIT) to render the first
  // screen, so what the user sees always comes from the server, not the message.
  static sendFlow(to, { flowId, flowToken, header, body, cta }) {
    return this.sendInteractive(to, {
      type: "flow",
      ...(header && { header: { type: "text", text: header } }),
      body: { text: body },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_id: flowId,
          flow_token: flowToken,
          flow_cta: cta,
          flow_action: "data_exchange",
        },
      },
    });
  }

  static async uploadMedia(buffer, mimeType, filename) {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mimeType);
    form.append("file", new Blob([buffer], { type: mimeType }), filename);
    const { data } = await axios.post(`${graphUrl}/${phoneNumberId}/media`, form, {
      headers: authHeaders(),
      timeout: 20000,
    });
    return data.id;
  }

  static async sendDocument(to, { buffer, filename, caption }) {
    try {
      const mediaId = await this.uploadMedia(buffer, "application/pdf", filename);
      return this.post({ to: normalizeMsisdn(to), type: "document", document: { id: mediaId, filename, caption } });
    } catch (err) {
      logger.error(`[WhatsApp] document upload failed [${err.response?.status || err.code}]`);
      return false;
    }
  }

  // Send whatever an intent handler returned: a string, { text }, { type: "interactive", payload }
  // and/or a { document: { buffer, filename } } attachment.
  static async sendReply(to, reply) {
    if (!reply) return;
    if (typeof reply === "string") return this.sendMessage(to, reply);
    if (reply.type === "interactive") await this.sendInteractive(to, reply.payload);
    else if (reply.text) await this.sendMessage(to, reply.text);
    if (reply.document?.buffer) await this.sendDocument(to, reply.document);
  }

  static async markRead(messageId) {
    if (!messageId) return;
    await this.post({ status: "read", message_id: messageId }, 1);
  }
}

export default WhatsAppService;

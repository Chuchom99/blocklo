// src/services/whatsapp.service.js
import axios from "axios";
import logger from "../config/logger.js";
import { langchainService } from "./ai.services.js";
import fs from "fs";
import crypto from "crypto";

class WhatsAppService {
  static normalizePhone(number) {
    return number.toString().replace(/[^\d]/g, "").replace(/^234/, "234");
  }

  // === DECRYPT FLOW DATA (SIGNUP / LOGIN) ===
  static decryptFlowData(
    encrypted_flow_data,
    encrypted_aes_key,
    initial_vector,
  ) {
    const privateKeyPem = fs.readFileSync("private_key.pem", "utf8");

    // THIS IS THE ONLY COMBINATION THAT WORKS WITH META RIGHT NOW
    const aesKey = crypto.privateDecrypt(
      {
        key: privateKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
        // These two lines are the magic fix:
        oaepLabel: Buffer.from("WhatsApp Encryption Payload", "utf8"),
        // Force MGF1-SHA256 (Meta's current requirement)
        oaepMGFFunction: (seed, length) =>
          crypto
            .createHmac("sha256", seed)
            .update("")
            .digest()
            .slice(0, length),
      },
      Buffer.from(encrypted_aes_key, "base64"),
    );

    if (aesKey.length !== 32) {
      throw new Error(
        `Invalid AES key length: ${aesKey.length} bytes (expected 32)`,
      );
    }

    const iv = Buffer.from(initial_vector, "base64");
    const encrypted = Buffer.from(encrypted_flow_data, "base64");
    const authTag = encrypted.slice(-16);
    const ciphertext = encrypted.slice(0, -16);

    const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString("utf8"));
  }

  static async sendMessage(to, text) {
    const recipient = this.normalizePhone(to);
    const payload = {
      messaging_product: "whatsapp",
      to: recipient,
      type: "text",
      text: { body: text },
    };

    for (let i = 0; i < 3; i++) {
      try {
        await axios.post(
          `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
            timeout: 10000,
          },
        );
        logger.info(`[WhatsApp → ${recipient}] ${text}`);
        return;
      } catch (err) {
        if (i === 2)
          logger.error(
            "Failed to send message:",
            err.response?.data || err.message,
          );
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  static async sendInteractive(to, interactive) {
    const recipient = this.normalizePhone(to);
    try {
      await axios.post(
        `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: recipient,
          type: "interactive",
          interactive,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          },
        },
      );
      logger.info(`[Interactive → ${recipient}] Sent`);
    } catch (err) {
      logger.error("Interactive failed:", err.response?.data);
      await this.sendMessage(to, "Please reply to continue.");
    }
  }

  // ONLY ONE JOB: Forward everything to AI
  static async handleIncomingMessage(
    rawFrom,
    message,
    messageId,
    profileName = "User",
  ) {
    const from = this.normalizePhone(rawFrom);
    const text = message.text?.body?.trim() || "";
    const isButton = message.interactive?.button_reply?.id;

    try {
      // Let AI handle EVERYTHING: onboarding, buttons, voice, registration, chat
      const reply = await langchainService.handleWhatsAppMessage({
        from,
        text,
        message,
        profileName,
        buttonId: isButton,
      });

      if (reply) {
        if (reply.type === "interactive") {
          await this.sendInteractive(from, reply.payload);
        } else {
          await this.sendMessage(from, reply.text);
        }
      }
    } catch (err) {
      logger.error("AI handler failed:", err);
      await this.sendMessage(from, "Sorry, I'm having issues. Try again soon.");
    }
  }

  static verifyWebhook(query) {
    if (
      query["hub.mode"] === "subscribe" &&
      query["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN
    ) {
      return query["hub.challenge"];
    }
    throw new Error("Forbidden");
  }
}

export default WhatsAppService;

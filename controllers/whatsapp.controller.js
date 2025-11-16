

// import WhatsAppService from "../services/whatsapp.services.js";
// import logger from "../config/logger.js";

// class WhatsAppController {
//   static verifyWebhook(req, res) {
//     try {
//       const { mode, token, challenge } = {
//         mode: req.query["hub.mode"],
//         token: req.query["hub.verify_token"],
//         challenge: req.query["hub.challenge"],
//       };

//       if (mode === "subscribe" && token === process.env.WHATSAPP_ACCESS_TOKEN) {
//         logger.info("✅ WhatsApp webhook verified");
//         return res.status(200).send(challenge);
//       }

//       logger.warn("❌ WhatsApp webhook verification failed");
//       return res.sendStatus(403);
//     } catch (err) {
//       logger.error(`[Webhook Verification Error] ${err.message}`);
//       return res.sendStatus(500);
//     }
//   }

//   static async handleWebhook(req, res) {
//     try {
//       const payload = req.body;
//       logger.info(`[Webhook] Incoming payload: ${JSON.stringify(payload, null, 2)}`);

//       if (!payload?.entry?.[0]?.changes?.[0]?.value) {
//         return res.status(400).json({ success: false, message: "Invalid payload" });
//       }

//       const value = payload.entry[0].changes[0].value;

//       if (value.messages && value.messages[0]) {
//         const message = value.messages[0];
//         const from = message.from;
//         const messageId = message.id;

//         if (message.type === "text") {
//           await WhatsAppService.handleIncomingMessage(from, message.text.body, messageId);
//         } else if (message.type === "interactive") {
//           await WhatsAppService.handleIncomingMessage(from, message, messageId);
//         }

//         return res.status(200).send("OK");
//       }

//       // Status updates
//       if (value.statuses && value.statuses[0]) {
//         const status = value.statuses[0];
//         logger.info(`📬 Status update: ${status.status} for message ${status.id}`);
//         return res.status(200).send("Status received");
//       }

//       res.status(200).send("Ignored");
//     } catch (error) {
//       logger.error(`[Webhook Error] ${error.message}`);
//       res.status(500).send("Webhook error");
//     }
//   }

//   static async handleFlow(req, res) {
//     try {
//       const { encrypted_flow_data, encrypted_aes_key, initial_vector } = req.body;

//       // Handle health ping
//       if (!encrypted_flow_data || !encrypted_aes_key || !initial_vector) {
//         const healthResponse = { response: { status: "SUCCESS", message: "Health check successful" } };
//         const encoded = Buffer.from(JSON.stringify(healthResponse)).toString("base64");
//         return res.status(200).type("text/plain").send(encoded);
//       }

//       const decrypted = await WhatsAppService.decryptFlowData(encrypted_flow_data, encrypted_aes_key, initial_vector);
//       const { screen, data, flowToken, aesKey, iv } = decrypted;

//       const result = await WhatsAppService.processFlow(screen, data, flowToken);

//       const encryptedResponse = WhatsAppService.encryptResponse(
//         JSON.stringify({ version: "3.0", data: { message: result } }),
//         aesKey,
//         iv
//       );

//       return res.status(200).type("text/plain").send(encryptedResponse);
//     } catch (error) {
//       logger.error(`[Flow Error] ${error.message}`);
//       const base64Error = Buffer.from(
//         JSON.stringify({ version: "3.0", error: { message: error.message } })
//       ).toString("base64");
//       return res.status(200).type("text/plain").send(base64Error);
//     }
//   }

//   static handleHealthCheck(req, res) {
//     const response = { response: { status: "SUCCESS", message: "Manual health check successful" } };
//     const encoded = Buffer.from(JSON.stringify(response)).toString("base64");
//     res.status(200).type("text/plain").send(encoded);
//   }
// }

// export default WhatsAppController;




import WhatsAppService from "../services/whatsapp.services.js";
import logger from "../config/logger.js";
import crypto from "crypto";

class WhatsAppController {
  static verifyWebhook(req, res) {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === process.env.WHATSAPP_ACCESS_TOKEN) {
      return res.send(challenge);
    }
    res.sendStatus(403);
  }

  static async handleWebhook(req, res) {
    try {
      const value = req.body.entry?.[0]?.changes?.[0]?.value;
      if (!value) return res.sendStatus(200);

      if (value.messages?.[0]) {
        const msg = value.messages[0];
        await WhatsAppService.handleIncomingMessage(
          msg.from,
          msg,
          msg.id,
          value.contacts?.[0]?.profile?.name
        );
      }

      if (value.statuses?.[0]) {
        logger.info(`Status: ${value.statuses[0].status}`);
      }

      res.sendStatus(200);
    } catch (err) {
      logger.error(err.message);
      res.sendStatus(500);
    }
  }

  static async handleFlow(req, res) {
    try {
      const { encrypted_flow_data, encrypted_aes_key, initial_vector } = req.body;
      if (!encrypted_flow_data) {
        const health = Buffer.from(JSON.stringify({ response: { status: "SUCCESS" } })).toString("base64");
        return res.type("text/plain").send(health);
      }

      const decrypted = WhatsAppService.decryptFlowData(encrypted_flow_data, encrypted_aes_key, initial_vector);
      const result = await WhatsAppService.processFlow(decrypted.screen, decrypted.data, decrypted.flowToken);

      const encrypted = WhatsAppService.encryptResponse(
        JSON.stringify({ version: "3.0", data: { message: result } }),
        decrypted.aesKey,
        decrypted.iv
      );

      res.type("text/plain").send(encrypted);
    } catch (err) {
      const error = Buffer.from(JSON.stringify({ version: "3.0", error: { message: err.message } })).toString("base64");
      res.type("text/plain").send(error);
    }
  }
}

export default WhatsAppController;
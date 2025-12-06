

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
import userController from "./user.controller.js";

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
;

static async handleFlow (req, res)  {
  try {
    const { encrypted_flow_data, encrypted_aes_key, initial_vector } = req.body;

    // Health check (Meta pings this)
    if (!encrypted_flow_data) {
      return res.status(200).send("SUCCESS");
    }

    // === DECRYPT ===
    const decrypted = WhatsAppService.decryptFlowData(
      encrypted_flow_data,
      encrypted_aes_key,
      initial_vector
    );
    console.log("🔓 Decrypted payload:", decrypted);
    logger.info("[Flow] Decrypted payload:", decrypted);

    // === EXTRACT FIELDS DIRECTLY (no .data, no .screen) ===
    const {
      first_name,
      last_name,
      email,
      DateOfBirth,
      address,
      nin,
      bvn,
      pin,
      confirm_pin,
      gender,
      terms_agreement,
    } = decrypted;

    const password = crypto.randomBytes(4).toString("hex")
    // === VALIDATE REQUIRED FIELDS ===
    if (!email || !first_name || !nin || !bvn || !pin) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields (email, name, NIN, BVN, PIN)",
      });
    }

    if (pin !== confirm_pin) {
      return res.status(400).json({
        success: false,
        message: "PINs do not match",
      });
    }

    // === CREATE USER ===
    const user = await UserService.createUser({
      firstName: first_name.trim(),
      lastName: last_name?.trim() || "User",
      email: email.trim(),
      dateOfBirth: DateOfBirth,
      address: address?.trim(),
      nin: nin.trim(),
      bvn: bvn.trim(),
      password:password,
      pin: pin,
      gender: gender === "Male" ? 0 : 1,
      whatsappId: req.body.from || req.query.from, // from webhook context
      phone: (req.body.from || req.query.from || "").replace("234", "0"),
      termsAgreed: Boolean(terms_agreement),
      kycLevel: 1,
    });

    // === SUCCESS RESPONSE (no encryption needed for final submit) ===
    res.json({
      success: true,
      message: "Account created successfully!",
      accountNumber: user.accountNumber || user.walletNumber,
    });

  } catch (err) {
    logger.error("[Flow Error]", err.message, err.stack);
    res.status(400).json({
      success: false,
      message: err.message || "Invalid request",
    });
  }
};



}

export default WhatsAppController;



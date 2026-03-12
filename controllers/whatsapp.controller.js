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
  };

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
  };

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



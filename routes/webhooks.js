// routes/webhook.routes.js
import express from "express";
const router = express.Router();
import crypto from "crypto";
import logger from "../config/logger.js";
import PsbService from "../services/psb.service.js";

// Basic Auth middleware (as per docs)
const basicAuth = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Basic ")) return res.status(401).json({ message: "Unauthorized" });

  const base64 = auth.split(" ")[1];
  const [username, password] = Buffer.from(base64, "base64").toString().split(":");
  
  if (username === process.env.PSB_WAAS_USERNAME && password === process.env.PSB_WAAS_PASSWORD) {
    return next();
  }
  return res.status(401).json({ message: "Invalid credentials" });
};

router.post("/9psb/webhook", basicAuth, async (req, res) => {
  try {
    const event = req.query.event;
    const payload = req.body;

    logger.info(`9PSB Webhook received: ${event}`, payload);

    if (event === "transfer") {
      // Handle inflow - short or long format
      const accountNumber = payload.accountnumbser || payload.accountnumber || payload.customer?.account?.number;
      const sessionID = payload.nipsessionid || payload.transaction?.externalreference;

      if (accountNumber && sessionID) {
        // Optionally requery for confirmation
        try {
          await PsbService.notificationRequery(sessionID, accountNumber);
          // TODO: credit user wallet in your DB, notify user, etc.
        } catch (e) {
          logger.warn(`Requery failed for ${sessionID}: ${e.message}`);
        }
      }
    } else if (event === "account-upgrade") {
      // Handle upgrade
      // TODO: update user tier
    }

    // Always acknowledge
    res.json({
      success: true,
      code: "00",
      status: "SUCCESS",
      message: "Acknowledged",
    });
  } catch (err) {
    logger.error(`Webhook error: ${err.message}`);
    res.status(500).json({ success: false, message: "Processing failed" });
  }
});

export default router;
import express from "express";
import WhatsAppController from "../controllers/whatsapp.controller.js";
import { verifyMetaSignature } from "../middlwares/metaSignature.middleware.js";
import { rateLimit } from "../middlwares/ratelimit.middleware.js";

const router = express.Router();

router.get("/webhook", WhatsAppController.verifyWebhook);
router.post("/webhook", verifyMetaSignature(401), WhatsAppController.handleWebhook);
router.post(
  "/flow",
  rateLimit({ name: "flow", max: 120, windowSec: 60 }),
  verifyMetaSignature(432),
  WhatsAppController.handleFlow,
);

export default router;

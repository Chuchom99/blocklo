import express from "express";
import { handle9psbWebhook } from "../controllers/webhook.controller.js";
import { basicAuth } from "../middlwares/auth.midlware.js";

const router = express.Router();

// Basic auth as required by 9PSB, plus optional IP allowlist (PSB_WEBHOOK_IPS).
router.post("/9psb/webhook", basicAuth, handle9psbWebhook);

export default router;

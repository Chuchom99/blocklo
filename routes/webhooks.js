// routes/webhook.routes.js
import express from "express";
import { handle9psbWebhook } from "../controllers/webhook.controller.js";
import { basicAuth } from "../middlwares/auth.midlware.js";

const router = express.Router();

// SECURE WITH BASIC AUTH (as requested by 9PSB)
router.post("/9psb/webhook", basicAuth, handle9psbWebhook);

export default router;
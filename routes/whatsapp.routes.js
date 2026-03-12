

import express from "express";
import WhatsAppController from "../controllers/whatsapp.controller.js";

 const router = express.Router();

router.get("/webhook", WhatsAppController.verifyWebhook);
router.post("/webhook", WhatsAppController.handleWebhook);
router.post("/flow", WhatsAppController.handleFlow);

export default router;
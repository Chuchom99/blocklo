import express from 'express';
import WhatsAppController from '../controllers/whatsapp.controller.js';

const router = express.Router();

// Middleware to log incoming requests
router.use((req, res, next) => {
  const timestamp = new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' });
  console.log(`[WhatsApp Endpoint] ${timestamp} - ${req.method} ${req.originalUrl}`);
  next();
});

router.post('/webhook', WhatsAppController.handleWebhook);
router.post('/flow', WhatsAppController.handleFlow);

export default router;
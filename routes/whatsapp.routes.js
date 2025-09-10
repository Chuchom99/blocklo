import express from 'express';
import WhatsAppController from '../controllers/whatsapp.controller.js';

const router = express.Router();

// Middleware to log incoming requests
router.use((req, res, next) => {
  const timestamp = new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' });
  console.log(`[WhatsApp Endpoint] ${timestamp} - ${req.method} ${req.originalUrl}`);
  next();
});

// ✅ Flow webhook endpoint (Meta will call this)
router.post('/flow', WhatsAppController.handleFlow);

// ✅ WhatsApp webhook (messages + verification)
router.post('/webhook', WhatsAppController.handleWebhook);

// ✅ Manual health check endpoint (for testing)
router.get('/flow/health', (req, res) => {
  const response = {
    response: {
      status: 'SUCCESS',
      message: 'Manual health check successful',
    },
  };
  const encodedResponse = Buffer.from(JSON.stringify(response)).toString('base64');
  res.status(200).type('text/plain').send(encodedResponse);
});

export default router;

import WhatsAppService from '../services/whatsapp.services.js';
import logger from '../config/logger.js';

class WhatsAppController {
  static async handleWebhook(req, res) {
    try {
      // Handle webhook verification
      if (req.query['hub.mode'] === 'subscribe') {
        const challenge = WhatsAppService.verifyWebhook(req);
        return res.status(200).send(challenge);
      }

      // Process incoming message
      const { entry } = req.body;
      if (!entry || !entry[0]?.changes?.[0]?.value?.messages?.[0]) {
        logger.warn('Invalid webhook payload');
        return res.status(400).json({ success: false, message: 'Invalid payload' });
      }

      const messageData = entry[0].changes[0].value.messages[0];
      const from = messageData.from;
      const messageId = messageData.id;
      let message;

      // Handle Flow response or text message
      if (messageData.type === 'interactive' && messageData.interactive?.type === 'flow') {
        message = messageData;
      } else if (messageData.type === 'text') {
        message = messageData.text.body;
      } else {
        logger.warn(`Unsupported message type from ${from}: ${messageData.type}`);
        return res.status(400).json({ success: false, message: 'Unsupported message type' });
      }

      await WhatsAppService.handleIncomingMessage(from, message, messageId);
      res.status(200).send('OK');
    } catch (error) {
      logger.error(`Webhook error: ${error.message}`);
      res.status(500).json({ success: false, message: 'Webhook error' });
    }
  }
}

export default WhatsAppController;
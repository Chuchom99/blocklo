// import WhatsAppService from '../services/whatsapp.services.js';
// import logger from '../config/logger.js';

// class WhatsAppController {
//   static async handleWebhook(req, res) {
//     try {
//       // Handle webhook verification
//       if (req.query['hub.mode'] === 'subscribe') {
//         const challenge = WhatsAppService.verifyWebhook(req);
//         return res.status(200).send(challenge);
//       }

//       // Process incoming message
//       const { entry } = req.body;
//       if (!entry || !entry[0]?.changes?.[0]?.value?.messages?.[0]) {
//         logger.warn('Invalid webhook payload');
//         return res.status(400).json({ success: false, message: 'Invalid payload' });
//       }

//       const messageData = entry[0].changes[0].value.messages[0];
//       const from = messageData.from;
//       const messageId = messageData.id;
//       let message;

//       // Handle Flow response or text message
//       if (messageData.type === 'interactive' && messageData.interactive?.type === 'flow') {
//         message = messageData;
//       } else if (messageData.type === 'text') {
//         message = messageData.text.body;
//       } else {
//         logger.warn(`Unsupported message type from ${from}: ${messageData.type}`);
//         return res.status(400).json({ success: false, message: 'Unsupported message type' });
//       }

//       await WhatsAppService.handleIncomingMessage(from, message, messageId);
//       res.status(200).send('OK');
//     } catch (error) {
//       logger.error(`Webhook error: ${error.message}`);
//       res.status(500).json({ success: false, message: 'Webhook error' });
//     }
//   }
// }

// export default WhatsAppController;

import WhatsAppService from '../services/whatsapp.services.js';
import logger from '../config/logger.js';

class WhatsAppController {
  static async handleWebhook(req, res) {
    try {
      // Log the webhook payload
      console.log(`[WhatsApp Webhook] Received payload: ${JSON.stringify(req.body, null, 2)}`);

      // Handle webhook verification
      if (req.query['hub.mode'] === 'subscribe') {
        const challenge = WhatsAppService.verifyWebhook(req);
        console.log(`[WhatsApp Webhook] Verification successful, challenge: ${challenge}`);
        return res.status(200).send(challenge);
      }

      // Process incoming message
      const { entry } = req.body;
      if (!entry || !entry[0]?.changes?.[0]?.value?.messages?.[0]) {
        console.log('[WhatsApp Webhook] Invalid payload received');
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
        console.log(`[WhatsApp Webhook] Unsupported message type from ${from}: ${messageData.type}`);
        logger.warn(`Unsupported message type from ${from}: ${messageData.type}`);
        return res.status(400).json({ success: false, message: 'Unsupported message type' });
      }

      await WhatsAppService.handleIncomingMessage(from, message, messageId);
      console.log(`[WhatsApp Webhook] Processed message from ${from}, messageId: ${messageId}`);
      res.status(200).send('OK');
    } catch (error) {
      console.log(`[WhatsApp Webhook] Error: ${error.message}`);
      logger.error(`Webhook error: ${error.message}`);
      res.status(500).json({ success: false, message: 'Webhook error' });
    }
  }

  static async handleFlowData(req, res) {
    try {
      // Log the Flow data payload
      console.log(`[WhatsApp Flow] Received payload: ${JSON.stringify(req.body, null, 2)}`);

      const { flow_token, data, screen } = req.body;
      if (!flow_token || !data || !screen) {
        console.log('[WhatsApp Flow] Invalid Flow payload received');
        logger.warn('Invalid Flow payload');
        return res.status(400).json({ success: false, message: 'Invalid Flow payload' });
      }

      // Extract WhatsApp number from headers or context (if provided by Meta)
      const from = req.headers['x-whatsapp-from'] || req.body.from; // Adjust based on Meta's headers
      if (!from) {
        console.log('[WhatsApp Flow] Missing WhatsApp number in payload');
        logger.warn('Missing WhatsApp number in Flow payload');
        return res.status(400).json({ success: false, message: 'Missing WhatsApp number' });
      }

      await WhatsAppService.handleFlowResponse(from, flow_token, screen, data);
      console.log(`[WhatsApp Flow] Processed Flow response from ${from}, flow_token: ${flow_token}`);
      res.status(200).json({ success: true });
    } catch (error) {
      console.log(`[WhatsApp Flow] Error: ${error.message}`);
      logger.error(`Flow endpoint error: ${error.message}`);
      res.status(500).json({ success: false, message: 'Flow endpoint error' });
    }
  }
}

export default WhatsAppController;
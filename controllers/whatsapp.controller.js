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

  static async handleFlow(req, res) {
    try {
      // Log the entire payload for debugging
      logger.info(`[WhatsApp Flow] Received payload: ${JSON.stringify(req.body, null, 2)}`);

      // Health check handling
      if (!req.body || Object.keys(req.body).length === 0) {
        logger.info('[WhatsApp Flow] Health check received');
        return res.status(200).json({
          response: {
            status: 'SUCCESS',
            message: 'Health check successful',
          },
        });
      }

      const { flow_token, screen, encrypted_flow_data, encrypted_flow_id, from } = req.body;

      // Validate required fields
      if (!flow_token || !screen || !encrypted_flow_data || !encrypted_flow_id || !from) {
        logger.warn(`[WhatsApp Flow] Invalid payload: missing required fields`);
        return res.status(400).json({
          response: {
            status: 'ERROR',
            message: 'Invalid Flow payload: missing required fields',
          },
        });
      }

      if (screen === 'SIGN_UP') {
        const decryptedData = await WhatsAppService.decryptFlowData(encrypted_flow_data, encrypted_flow_id);
        // Validate phone matches WhatsApp number
        if (decryptedData.phone !== from) {
          logger.warn(`[WhatsApp Flow] Phone mismatch: ${decryptedData.phone} != ${from}`);
          return res.status(400).json({
            response: {
              status: 'ERROR',
              message: 'Phone number must match your WhatsApp number.',
            },
          });
        }

        // Process registration: Save to Supabase
        try {
          const hashedPassword = await bcrypt.hash(decryptedData.password, 10);
          const hashedPin = await bcrypt.hash(decryptedData.pin, 10);

          const newUser = await prisma.user.create({
            data: {
              firstName: decryptedData.firstName,
              lastName: decryptedData.lastName,
              email: decryptedData.email,
              whatsappId: decryptedData.phone,
              password: hashedPassword,
              transactionPin: hashedPin,
              termsAgreed: decryptedData.terms_agreement,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });

          logger.info(`[WhatsApp Flow] User registered: ${newUser.email}`);
        } catch (dbError) {
          logger.error(`[WhatsApp Flow] Database error: ${dbError.message}`);
          return res.status(500).json({
            response: {
              status: 'ERROR',
              message: 'Failed to register user',
            },
          });
        }

        return res.status(200).json({
          response: {
            status: 'SUCCESS',
            message: `Registration successful! Welcome, ${decryptedData.firstName}.`,
          },
        });
      }

      // Default response for other screens or health checks
      return res.status(200).json({
        response: {
          status: 'SUCCESS',
          message: 'Flow request processed',
        },
      });
    } catch (error) {
      logger.error(`[WhatsApp Flow] Error: ${error.message}`);
      return res.status(500).json({
        response: {
          status: 'ERROR',
          message: 'Internal server error',
        },
      });
    }
  }
}

export default WhatsAppController;



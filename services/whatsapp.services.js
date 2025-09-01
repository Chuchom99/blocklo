// import axios from 'axios';
// import logger from '../config/logger.js';
// import { langchainService } from './ai.services.js';
// import prisma from '../config/prisma.js';
// import UserService from './user.service.js';

// class WhatsAppService {
//   static async sendMessage(to, message) {
//     try {
//       if (!process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_ACCESS_TOKEN) {
//         throw new Error('Missing WhatsApp configuration');
//       }

//       const response = await axios.post(
//         `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
//         {
//           messaging_product: 'whatsapp',
//           to,
//           type: 'text',
//           text: { body: message },
//         },
//         {
//           headers: {
//             Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
//             'Content-Type': 'application/json',
//           },
//         }
//       );
//       logger.info(`Message sent to ${to}: ${message}`);
//       return response.data;
//     } catch (error) {
//       logger.error(`Error sending WhatsApp message to ${to}: ${error.response?.data?.error?.message || error.message}`);
//       throw new Error(`Failed to send message: ${error.message}`);
//     }
//   }

//   static async sendRegistrationFlow(to, flowId, flowToken) {
//     try {
//       const response = await axios.post(
//         `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
//         {
//           messaging_product: 'whatsapp',
//           to,
//           type: 'interactive',
//           interactive: {
//             type: 'flow',
//             action: {
//               name: 'flow',
//               parameters: {
//                 flow_id: flowId,
//                 flow_token: flowToken,
//                 flow_action: 'data_exchange',
//                 flow_cta: 'Register Now',
//               },
//             },
//           },
//         },
//         {
//           headers: {
//             Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
//             'Content-Type': 'application/json',
//           },
//         }
//       );
//       logger.info(`Registration Flow sent to ${to}: Flow ID ${flowId}`);
//       return response.data;
//     } catch (error) {
//       logger.error(`Error sending registration Flow to ${to}: ${error.response?.data?.error?.message || error.message}`);
//       throw new Error(`Failed to send registration Flow: ${error.message}`);
//     }
//   }

//   static async handleIncomingMessage(from, message, messageId) {
//     try {
//       // Map WhatsApp ID to user
//       let user = await prisma.user.findUnique({ where: { whatsappId: from } });
//       const userId = user ? user.id : null;

//       logger.info(`Received message from ${from} (user ${userId || 'unknown'}): ${message}`);

//       // Check if message is a Flow response
//       if (typeof message === 'object' && message.type === 'interactive' && message.interactive?.type === 'flow') {
//         const flowData = message.interactive.flow_response?.data;
//         if (flowData && flowData.screen === 'REGISTRATION_FORM') {
//           const { email, phone, firstName, lastName, password, pin } = flowData;
//           const whatsappId = from;

//           // Register user
//           const newUser = await UserService.createUser({
//             email,
//             phone,
//             password,
//             firstName,
//             lastName,
//             pin,
//             whatsappId,
//           });

//           await this.sendMessage(from, `Registration successful! Welcome, ${firstName}.`);
//           logger.info(`User registered via Flow from ${from}: ${email}`);
//           return;
//         }
//       }

//       // Process other messages with LangChain
//       const response = await langchainService.processMessage(from, message, userId);
//       await this.sendMessage(from, response);
//       logger.info(`Handled message from ${from} (user ${userId || 'unknown'}): ${message} -> Response: ${response}`);
//       return response;
//     } catch (error) {
//       logger.error(`Error handling message from ${from}: ${error.message}`);
//       await this.sendMessage(from, 'Sorry, something went wrong. Please try again.');
//     }
//   }

//   static verifyWebhook(req) {
//     const mode = req.query['hub.mode'];
//     const token = req.query['hub.verify_token'];
//     const challenge = req.query['hub.challenge'];

//     if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
//       logger.info('Webhook verified successfully');
//       return challenge;
//     }
//     logger.warn('Webhook verification failed');
//     throw new Error('Invalid verify token');
//   }
// }

// export default WhatsAppService;



import axios from 'axios';
import logger from '../config/logger.js';
import { langchainService } from './ai.services.js';
import prisma from '../config/prisma.js';
import UserService from './user.service.js';

class WhatsAppService {
  static async sendMessage(to, message) {
    try {
      if (!process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_ACCESS_TOKEN) {
        throw new Error('Missing WhatsApp configuration');
      }

      const response = await axios.post(
        `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: message },
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      );
      logger.info(`Message sent to ${to}: ${message}`);
      return response.data;
    } catch (error) {
      logger.error(`Error sending WhatsApp message to ${to}: ${error.response?.data?.error?.message || error.message}`);
      throw new Error(`Failed to send message: ${error.message}`);
    }
  }

  static async sendRegistrationFlow(to, flowId, flowToken) {
    try {
      const response = await axios.post(
        `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: 'whatsapp',
          to,
          type: 'interactive',
          interactive: {
            type: 'flow',
            action: {
              name: 'flow',
              parameters: {
                flow_id: flowId,
                flow_token: flowToken,
                flow_action: 'data_exchange',
                flow_cta: 'Register or Sign In',
                whatsapp_number: to, // Pass WhatsApp number to pre-fill phone field
              },
            },
          },
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      );
      logger.info(`Flow sent to ${to}: Flow ID ${flowId}`);
      return response.data;
    } catch (error) {
      logger.error(`Error sending Flow to ${to}: ${error.response?.data?.error?.message || error.message}`);
      throw new Error(`Failed to send Flow: ${error.message}`);
    }
  }

  static async handleIncomingMessage(from, message, messageId) {
    try {
      // Map WhatsApp ID to user
      let user = await prisma.user.findUnique({ where: { whatsappId: from } });
      const userId = user ? user.id : null;

      logger.info(`Received message from ${from} (user ${userId || 'unknown'}): ${JSON.stringify(message)}`);

      // Handle Flow response
      if (typeof message === 'object' && message.type === 'interactive' && message.interactive?.type === 'flow') {
        const flowData = message.interactive.flow_response?.data;
        const screen = message.interactive.flow_response?.screen;

        if (screen === 'SIGN_UP' && flowData) {
          const { firstName, lastName, email, phone, password, pin, terms_agreement } = flowData;
          if (!terms_agreement) {
            await this.sendMessage(from, 'You must agree to the terms and conditions to register.');
            return;
          }
          if (phone !== from) {
            await this.sendMessage(from, 'Phone number must match your WhatsApp number.');
            return;
          }

          const newUser = await UserService.createUser({
            email,
            phone,
            firstName,
            lastName,
            password,
            pin,
            whatsappId: phone, // Use phone as whatsappId
          });

          await this.sendMessage(from, `Registration successful! Welcome, ${firstName}.`);
          logger.info(`User registered via Flow from ${from}: ${email}`);
          return;
        } else if (screen === 'SIGN_IN' && flowData) {
          const { identifier, password } = flowData;
          const user = await UserService.findByIdentifier(identifier);
          if (!user) {
            await this.sendMessage(from, 'User not found. Please register first.');
            return;
          }

          const valid = await UserService.verifyPassword(user.id, password);
          if (!valid) {
            await this.sendMessage(from, 'Invalid credentials. Please try again.');
            return;
          }

          await this.sendMessage(from, `Login successful! Welcome back, ${user.firstName}.`);
          logger.info(`User logged in via Flow from ${from}: ${identifier}`);
          return;
        }
      }

      // Process other messages with LangChain
      const response = await langchainService.processMessage(from, message, userId);
      await this.sendMessage(from, response);
      logger.info(`Handled message from ${from} (user ${userId || 'unknown'}): ${JSON.stringify(message)} -> Response: ${response}`);
      return response;
    } catch (error) {
      logger.error(`Error handling message from ${from}: ${error.message}`);
      await this.sendMessage(from, 'Sorry, something went wrong. Please try again.');
    }
  }

  static verifyWebhook(req) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      logger.info('Webhook verified successfully');
      return challenge;
    }
    logger.warn('Webhook verification failed');
    throw new Error('Invalid verify token');
  }
}

export default WhatsAppService;


// import WhatsAppService from '../services/whatsapp.services.js';
// import logger from '../config/logger.js';
// import bcrypt from 'bcryptjs';
// import prisma from '../config/prisma.js';

// class WhatsAppController {
//   static async handleFlow(req, res) {
//     try {
//       // Log the entire payload for debugging
//       logger.info(`[WhatsApp Flow] Received payload: ${JSON.stringify(req.body, null, 2)}`);

//       // Health check handling: Accept any payload
//       if (!req.body || Object.keys(req.body).length === 0 || !req.body.encrypted_flow_data) {
//         logger.info('[WhatsApp Flow] Health check or partial payload received');
//         return res.status(200).json({
//           response: {
//             status: 'SUCCESS',
//             message: 'Health check successful',
//           },
//         });
//       }

//       const { flow_token, screen, encrypted_flow_data, encrypted_flow_id, from } = req.body;

//       // Validate required fields for non-health-check requests
//       if (!flow_token || !screen || !encrypted_flow_data || !encrypted_flow_id || !from) {
//         logger.warn(`[WhatsApp Flow] Invalid payload: missing required fields`);
//         const response = {
//           response: {
//             status: 'ERROR',
//             message: 'Invalid Flow payload: missing required fields',
//           },
//         };
//         const encodedResponse = Buffer.from(JSON.stringify(response)).toString('base64');
//         return res.status(400).json(encodedResponse);
//       }

//       if (screen === 'SIGN_UP') {
//         const decryptedData = await WhatsAppService.decryptFlowData(encrypted_flow_data, encrypted_flow_id);
//         // Validate phone matches WhatsApp number
//         if (decryptedData.phone !== from) {
//           logger.warn(`[WhatsApp Flow] Phone mismatch: ${decryptedData.phone} != ${from}`);
//           const response = {
//             response: {
//               status: 'ERROR',
//               message: 'Phone number must match your WhatsApp number.',
//             },
//           };
//           const encodedResponse = Buffer.from(JSON.stringify(response)).toString('base64');
//           return res.status(400).json(encodedResponse);
//         }

//         // Validate required fields in decrypted data
//         if (!decryptedData.firstName || !decryptedData.lastName || !decryptedData.email || !decryptedData.phone || !decryptedData.password || !decryptedData.pin || !decryptedData.terms_agreement) {
//           logger.warn(`[WhatsApp Flow] Missing required fields in decrypted data: ${JSON.stringify(decryptedData)}`);
//           const response = {
//             response: {
//               status: 'ERROR',
//               message: 'Missing required registration fields',
//             },
//           };
//           const encodedResponse = Buffer.from(JSON.stringify(response)).toString('base64');
//           return res.status(400).json(encodedResponse);
//         }

//         // Process registration: Save to Supabase
//         try {
//           // Check for existing email or whatsappId
//           const existingUser = await prisma.user.findFirst({
//             where: {
//               OR: [
//                 { email: decryptedData.email },
//                 { whatsappId: decryptedData.phone },
//               ],
//             },
//           });
//           if (existingUser) {
//             logger.warn(`[WhatsApp Flow] User already exists: email=${decryptedData.email}, whatsappId=${decryptedData.phone}`);
//             const response = {
//               response: {
//                 status: 'ERROR',
//                 message: 'Email or phone number already registered',
//               },
//             };
//             const encodedResponse = Buffer.from(JSON.stringify(response)).toString('base64');
//             return res.status(400).json(encodedResponse);
//           }

//           const hashedPassword = await bcrypt.hash(decryptedData.password, 10);
//           const hashedPin = await bcrypt.hash(decryptedData.pin, 10);

//           const newUser = await prisma.user.create({
//             data: {
//               firstName: decryptedData.firstName,
//               lastName: decryptedData.lastName,
//               email: decryptedData.email,
//               whatsappId: decryptedData.phone,
//               password: hashedPassword,
//               transactionPin: hashedPin,
//               termsAgreed: decryptedData.terms_agreement,
//               createdAt: new Date(),
//               updatedAt: new Date(),
//             },
//           });

//           logger.info(`[WhatsApp Flow] User registered: ${newUser.email}`);
//           await WhatsAppService.sendMessage(from, `Registration successful! Welcome, ${newUser.firstName}.`);
          
//           const response = {
//             response: {
//               status: 'SUCCESS',
//               message: `Registration successful! Welcome, ${decryptedData.firstName}.`,
//             },
//           };
//           const encodedResponse = Buffer.from(JSON.stringify(response)).toString('base64');
//           return res.status(200).json(encodedResponse);
//         } catch (dbError) {
//           logger.error(`[WhatsApp Flow] Database error: ${dbError.message}`);
//           const response = {
//             response: {
//               status: 'ERROR',
//               message: 'Failed to register user',
//             },
//           };
//           const encodedResponse = Buffer.from(JSON.stringify(response)).toString('base64');
//           return res.status(500).json(encodedResponse);
//         }
//       }

//       // Default response for other screens
//       const response = {
//         response: {
//           status: 'SUCCESS',
//           message: 'Flow request processed',
//         },
//       };
//       const encodedResponse = Buffer.from(JSON.stringify(response)).toString('base64');
//       return res.status(200).json(encodedResponse);
//     } catch (error) {
//       logger.error(`[WhatsApp Flow] Error: ${error.message}`);
//       const response = {
//         response: {
//           status: 'ERROR',
//           message: 'Internal server error',
//         },
//       };
//       const encodedResponse = Buffer.from(JSON.stringify(response)).toString('base64');
//       return res.status(500).json(encodedResponse);
//     }
//   }

//   static async handleWebhook(req, res) {
//     try {
//       // Log the webhook payload
//       console.log(`[WhatsApp Webhook] Received payload: ${JSON.stringify(req.body, null, 2)}`);

//       // Handle webhook verification
//       if (req.query['hub.mode'] === 'subscribe') {
//         const challenge = WhatsAppService.verifyWebhook(req);
//         console.log(`[WhatsApp Webhook] Verification successful, challenge: ${challenge}`);
//         return res.status(200).send(challenge);
//       }

//       // Process incoming message
//       const { entry } = req.body;
//       if (!entry || !entry[0]?.changes?.[0]?.value?.messages?.[0]) {
//         console.log(`[WhatsApp Webhook] Invalid payload received`);
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
//         console.log(`[WhatsApp Webhook] Unsupported message type from ${from}: ${messageData.type}`);
//         logger.warn(`Unsupported message type from ${from}: ${messageData.type}`);
//         return res.status(400).json({ success: false, message: 'Unsupported message type' });
//       }

//       await WhatsAppService.handleIncomingMessage(from, message, messageId);
//       console.log(`[WhatsApp Webhook] Processed message from ${from}, messageId: ${messageId}`);
//       res.status(200).send('OK');
//     } catch (error) {
//       console.log(`[WhatsApp Webhook] Error: ${error.message}`);
//       logger.error(`Webhook error: ${error.message}`);
//       res.status(500).json({ success: false, message: 'Webhook error' });
//     }
//   }
// }

// export default WhatsAppController;


import WhatsAppService from '../services/whatsapp.services.js';
import logger from '../config/logger.js';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma.js'; 

class WhatsAppController {
// static async handleFlow(req, res) {
//   try {
//     logger.info(`[WhatsApp Flow] Received payload: ${JSON.stringify(req.body, null, 2)}`);

//     const { flow_token, screen, encrypted_flow_data, encrypted_flow_id, from } = req.body || {};

//     // ✅ Health check case: Meta sends flow_token & screen, but no encrypted_flow_data
//     if (!encrypted_flow_data) {
//       const response = {
//         response: {
//           status: "SUCCESS",
//           message: "Health check successful",
//         },
//       };
//       const encodedResponse = Buffer.from(JSON.stringify(response)).toString("base64");
//       return res.status(200).type("text/plain").send(encodedResponse);
//     }

//     // ✅ Now enforce required fields for real flow requests
//     if (!flow_token || !screen || !encrypted_flow_data || !encrypted_flow_id || !from) {
//       const response = {
//         response: {
//           status: "ERROR",
//           message: "Invalid Flow payload: missing required fields",
//         },
//       };
//       const encodedResponse = Buffer.from(JSON.stringify(response)).toString("base64");
//       return res.status(400).type("text/plain").send(encodedResponse);
//     }

//     // 🔐 Decrypt incoming flow data
//     const decryptedData = decryptFlowData(encrypted_flow_data, process.env.WHATSAPP_FLOW_ENCRYPTION_KEY);
//     logger.info(`[WhatsApp Flow] Decrypted data: ${JSON.stringify(decryptedData, null, 2)}`);

//     let responseData;

//     switch (screen) {
//       case "SIGN_UP":
//         responseData = {
//           response: {
//             status: "SUCCESS",
//             data: {
//               message: "Sign-up successful",
//               user: decryptedData,
//             },
//           },
//         };
//         break;

//       case "SIGN_IN":
//         responseData = {
//           response: {
//             status: "SUCCESS",
//             data: {
//               message: "Sign-in successful",
//               user: decryptedData,
//             },
//           },
//         };
//         break;

//       default:
//         responseData = {
//           response: {
//             status: "ERROR",
//             message: "Unknown screen",
//           },
//         };
//         break;
//     }

//     // ✅ Encode response in Base64 (as required by Meta)
//     const encodedResponse = Buffer.from(JSON.stringify(responseData)).toString("base64");
//     return res.status(200).type("text/plain").send(encodedResponse);

//   } catch (error) {
//     logger.error(`[WhatsApp Flow] Error: ${error.message}`);

//     const response = {
//       response: {
//         status: "ERROR",
//         message: "Internal server error",
//       },
//     };
//     const encodedResponse = Buffer.from(JSON.stringify(response)).toString("base64");
//     return res.status(500).type("text/plain").send(encodedResponse);
//   }
// }

static async handleFlow(req, res) {
  try {
    logger.info(`[WhatsApp Flow] Received payload: ${JSON.stringify(req.body, null, 2)}`);

    const { encrypted_flow_data, encrypted_aes_key, initial_vector } = req.body || {};

    // Health check: No encrypted fields (unencrypted ping variant)
    if (!encrypted_flow_data || !encrypted_aes_key || !initial_vector) {
      const responseData = {
        version: "3.0",
        data: {
          message: "Health check successful",
        },
      };
      const encodedResponse = Buffer.from(JSON.stringify(responseData)).toString("base64");
      return res.status(200).type("text/plain").send(encodedResponse);
    }

    // Decrypt
    const decrypted = await WhatsAppService.decryptFlowData(encrypted_flow_data, encrypted_aes_key, initial_vector);
    const { screen, data: flowData = {}, flowToken, aesKey, iv, action } = decrypted;  // action is string or object
    const from = flowData.phone || 'unknown';  // Extract from pre-filled phone

    logger.info(`[WhatsApp Flow] Processing screen '${screen}' from ${from}, flow_token: ${flowToken}, action type: ${typeof action}, action value: ${JSON.stringify(action)}`);

    // Handle ping explicitly (encrypted health check variant - action is string "ping")
    if (action === 'ping') {
      logger.info(`[WhatsApp Flow] Health ping from ${from || 'unknown'} - responding active`);
      const responseData = {
        version: "3.0",
        data: { status: "active" },  // Exact format expected by Meta for pings
      };
      const encryptedResponse = WhatsAppService.encryptResponse(JSON.stringify(responseData), aesKey, iv);
      return res.status(200).type("text/plain").send(encryptedResponse);
    }

    // For data_exchange, action should be an object {name: "data_exchange"}
    const actionName = typeof action === 'object' ? action.name : action;
    if (actionName !== 'data_exchange') {
      logger.warn(`[WhatsApp Flow] Unexpected action '${actionName}' from ${from} - skipping user processing.`);
      const responseData = {
        version: "3.0",
        data: {
          message: "Action not supported.",
        },
      };
      const encryptedResponse = WhatsAppService.encryptResponse(JSON.stringify(responseData), aesKey, iv);
      return res.status(200).type("text/plain").send(encryptedResponse);
    }

    // Handle missing/invalid screen gracefully (e.g., stubs or invalid data_exchange)
    if (!screen || screen === 'UNKNOWN' || screen === 'undefined') {
      logger.warn(`[WhatsApp Flow] No valid screen in payload from ${from}. Treating as incomplete submission.`);
      const responseData = {
        version: "3.0",
        data: {
          message: "Flow received, but incomplete. Please try submitting again.",
        },
      };
      const encryptedResponse = WhatsAppService.encryptResponse(JSON.stringify(responseData), aesKey, iv);
      return res.status(200).type("text/plain").send(encryptedResponse);
    }

    // Process user logic (only if valid screen and action is data_exchange)
    let responseMessage = "Operation successful";
    if (screen === 'SIGN_UP') {
      const { firstName, lastName, email, phone, password, pin, terms_agreement } = flowData;
      if (!terms_agreement) {
        throw new Error("You must agree to the terms and conditions to register.");
      }
      if (phone !== from) {
        throw new Error("Phone number must match your WhatsApp number.");
      }

      const newUser = await UserService.createUser({
        email,
        phone,
        firstName,
        lastName,
        password,
        pin,
        whatsappId: phone,
      });

      responseMessage = `Registration successful! Welcome, ${firstName}.`;
      logger.info(`User registered via Flow from ${from}: ${email}, flow_token: ${flowToken}`);
    } else if (screen === 'SIGN_IN') {
      const { identifier, password } = flowData;
      const user = await UserService.findByIdentifier(identifier);
      if (!user) {
        throw new Error("User not found. Please register first.");
      }

      const valid = await UserService.verifyPassword(user.id, password);
      if (!valid) {
        throw new Error("Invalid credentials. Please try again.");
      }

      responseMessage = `Login successful! Welcome back, ${user.firstName}.`;
      logger.info(`User logged in via Flow from ${from}: ${identifier}, flow_token: ${flowToken}`);
    } else {
      logger.warn(`[WhatsApp Flow] Unsupported screen '${screen}' from ${from}. Returning generic success.`);
      responseMessage = "Flow completed.";
    }

    // Prepare success response
    const responseData = {
      version: "3.0",
      data: {
        message: responseMessage,
      },
    };

    // Encrypt response
    const encryptedResponse = WhatsAppService.encryptResponse(JSON.stringify(responseData), aesKey, iv);
    return res.status(200).type("text/plain").send(encryptedResponse);

  } catch (error) {
    logger.error(`[WhatsApp Flow] Error: ${error.message}`);

    const responseData = {
      version: "3.0",
      error: {
        message: error.message || "Internal server error",
      },
    };

    // Always plain base64 for errors (no encryption possible/attempted, as per Meta best practices)
    const encodedResponse = Buffer.from(JSON.stringify(responseData)).toString("base64");
    return res.status(200).type("text/plain").send(encodedResponse);
  }
}

  static async handleWebhook(req, res) {
    try {
      console.log(`[WhatsApp Webhook] Received payload: ${JSON.stringify(req.body, null, 2)}`);

      if (req.query['hub.mode'] === 'subscribe') {
        const challenge = WhatsAppService.verifyWebhook(req);
        console.log(`[WhatsApp Webhook] Verification successful, challenge: ${challenge}`);
        return res.status(200).send(challenge);
      }

      const { entry } = req.body;
      if (!entry || !entry[0]?.changes?.[0]?.value?.messages?.[0]) {
        console.log(`[WhatsApp Webhook] Invalid payload`);
        logger.warn('Invalid webhook payload');
        return res.status(400).json({ success: false, message: 'Invalid payload' });
      }

      const messageData = entry[0].changes[0].value.messages[0];
      const from = messageData.from;
      const messageId = messageData.id;
      let message;

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
}

export default WhatsAppController;


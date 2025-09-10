
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
//                 flow_cta: 'Register or Sign In',
//                 whatsapp_number: to, // Pass WhatsApp number to pre-fill phone field
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
//       logger.info(`Flow sent to ${to}: Flow ID ${flowId}`);
//       return response.data;
//     } catch (error) {
//       logger.error(`Error sending Flow to ${to}: ${error.response?.data?.error?.message || error.message}`);
//       throw new Error(`Failed to send Flow: ${error.message}`);
//     }
//   }

//   static async handleIncomingMessage(from, message, messageId) {
//     try {
//       // Map WhatsApp ID to user
//       let user = await prisma.user.findUnique({ where: { whatsappId: from } });
//       const userId = user ? user.id : null;

//       logger.info(`Received message from ${from} (user ${userId || 'unknown'}): ${JSON.stringify(message)}`);

//       // Handle Flow response
//       if (typeof message === 'object' && message.type === 'interactive' && message.interactive?.type === 'flow') {
//         const flowData = message.interactive.flow_response?.data;
//         const screen = message.interactive.flow_response?.screen;

//         if (screen === 'SIGN_UP' && flowData) {
//           const { firstName, lastName, email, phone, password, pin, terms_agreement } = flowData;
//           if (!terms_agreement) {
//             await this.sendMessage(from, 'You must agree to the terms and conditions to register.');
//             return;
//           }
//           if (phone !== from) {
//             await this.sendMessage(from, 'Phone number must match your WhatsApp number.');
//             return;
//           }

//           const newUser = await UserService.createUser({
//             email,
//             phone,
//             firstName,
//             lastName,
//             password,
//             pin,
//             whatsappId: phone, // Use phone as whatsappId
//           });

//           await this.sendMessage(from, `Registration successful! Welcome, ${firstName}.`);
//           logger.info(`User registered via Flow from ${from}: ${email}`);
//           return;
//         } else if (screen === 'SIGN_IN' && flowData) {
//           const { identifier, password } = flowData;
//           const user = await UserService.findByIdentifier(identifier);
//           if (!user) {
//             await this.sendMessage(from, 'User not found. Please register first.');
//             return;
//           }

//           const valid = await UserService.verifyPassword(user.id, password);
//           if (!valid) {
//             await this.sendMessage(from, 'Invalid credentials. Please try again.');
//             return;
//           }

//           await this.sendMessage(from, `Login successful! Welcome back, ${user.firstName}.`);
//           logger.info(`User logged in via Flow from ${from}: ${identifier}`);
//           return;
//         }
//       }

//       // Process other messages with LangChain
//       const response = await langchainService.processMessage(from, message, userId);
//       await this.sendMessage(from, response);
//       logger.info(`Handled message from ${from} (user ${userId || 'unknown'}): ${JSON.stringify(message)} -> Response: ${response}`);
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



import logger from '../config/logger.js';
import { langchainService } from './ai.services.js';
import prisma from '../config/prisma.js';
import UserService from './user.service.js';
import axios from 'axios';
import fs from "fs";
import crypto from "crypto";  // Full module import first
import { privateDecrypt, createDecipheriv, createCipheriv } from "crypto";   





class WhatsAppService {
   static async uploadPublicKey() {
    try {
      if (!process.env.WHATSAPP_REGISTRATION_FLOW_ID) {
        throw new Error('WHATSAPP_REGISTRATION_FLOW_ID is not set in .env');
      }
      if (!process.env.WHATSAPP_PHONE_NUMBER_ID) {
        throw new Error('WHATSAPP_PHONE_NUMBER_ID is not set in .env');
      }
      const publicKey = fs.readFileSync('public_key.pem', 'utf8');
      const response = await axios.post(
        `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/whatsapp_business_encryption`,
        {
          business_public_key: publicKey,
          enabled: true
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      );
      console.log(`[WhatsApp] Public key uploaded for Phone Number ${process.env.WHATSAPP_PHONE_NUMBER_ID}:`, response.data);
      logger.info(`Public key uploaded for Phone Number ${process.env.WHATSAPP_PHONE_NUMBER_ID}`);
      return response.data;
    } catch (error) {
      const errorMessage = error.response?.data?.error?.message || error.message;
      console.error(`[WhatsApp] Failed to upload public key for Phone Number ${process.env.WHATSAPP_PHONE_NUMBER_ID}:`, error.response?.data || error.message);
      logger.error(`Failed to upload public key: ${errorMessage}`);
      throw new Error(`Failed to upload public key: ${errorMessage}`);
    }
  }




  //   static async decryptFlowData(encryptedFlowData, encryptedFlowId) {
  //   try {
  //     if (!process.env.WHATSAPP_FLOW_PRIVATE_KEY) {
  //       throw new Error('WHATSAPP_FLOW_PRIVATE_KEY is not set in .env');
  //     }

  //     // Decode Base64-encoded private key
  //     const privateKey = Buffer.from(process.env.WHATSAPP_FLOW_PRIVATE_KEY, 'base64').toString('utf8');
      
  //     // Validate encrypted_flow_data format
  //     if (typeof encryptedFlowData !== 'string' || !encryptedFlowData.includes('.')) {
  //       logger.warn(`[WhatsApp Flow] Invalid encrypted_flow_data format: ${encryptedFlowData}`);
  //       throw new Error('Invalid encrypted_flow_data format');
  //     }

  //     const [iv, encrypted, authTag] = encryptedFlowData.split('.');
  //     if (!iv || !encrypted || !authTag) {
  //       logger.warn(`[WhatsApp Flow] Incomplete encrypted_flow_data components: iv=${iv}, encrypted=${encrypted}, authTag=${authTag}`);
  //       throw new Error('Invalid encrypted_flow_data format');
  //     }

  //     // Validate encrypted_flow_id
  //     if (encryptedFlowId !== process.env.WHATSAPP_REGISTRATION_FLOW_ID) {
  //       logger.warn(`[WhatsApp Flow] Flow ID mismatch: ${encryptedFlowId} != ${process.env.WHATSAPP_REGISTRATION_FLOW_ID}`);
  //       throw new Error('Invalid flow ID');
  //     }

  //     // Decrypt using AES-256-GCM
  //     const key = createHash('sha256').update(privateKey).digest();
  //     const decipher = createDecipheriv(
  //       'aes-256-gcm',
  //       key,
  //       Buffer.from(iv, 'base64')
  //     );
  //     decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  //     let decrypted = decipher.update(Buffer.from(encrypted, 'base64'));
  //     decrypted = Buffer.concat([decrypted, decipher.final()]);
      
  //     const decryptedData = JSON.parse(decrypted.toString('utf8'));
  //     logger.info(`[WhatsApp Flow] Decrypted data: ${JSON.stringify(decryptedData, null, 2)}`);
      
  //     return decryptedData;
  //   } catch (error) {
  //     logger.error(`[WhatsApp Flow] Decryption error: ${error.message}`);
  //     throw new Error(`Failed to decrypt flow data: ${error.message}`);
  //   }
  // }

static async decryptFlowData(encryptedFlowData, encryptedAesKey, initialVector) {
  try {
    // Load private key from PEM file (no .env fallback)
    const privateKeyPem = fs.readFileSync("private_key.pem", "utf8").trim();
    if (!privateKeyPem.startsWith('-----BEGIN PRIVATE KEY-----') && !privateKeyPem.startsWith('-----BEGIN RSA PRIVATE KEY-----')) {
      throw new Error("Invalid private key format in private_key.pem: Must be PEM-encoded RSA key");
    }

    // Check for constants availability
    if (typeof crypto.constants === 'undefined') {
      throw new Error("crypto.constants is undefined. Ensure 'import crypto from \"crypto\";' is at the top of the file.");
    }

    // Step 1: Base64 decode the inputs
    const encryptedAesKeyBuffer = Buffer.from(encryptedAesKey, "base64");
    const ivBuffer = Buffer.from(initialVector, "base64");
    const encryptedDataBuffer = Buffer.from(encryptedFlowData, "base64");

    if (encryptedAesKeyBuffer.length === 0 || ivBuffer.length !== 16 || encryptedDataBuffer.length < 16) {
      throw new Error(`Invalid input buffer lengths: AES key ${encryptedAesKeyBuffer.length}, IV ${ivBuffer.length}, Data ${encryptedDataBuffer.length}`);
    }

    // Warn on suspiciously short data (like in your logs)
    if (encryptedDataBuffer.length < 100) {
      logger.warn(`[WhatsApp Flow] Suspiciously short encrypted_data (${encryptedDataBuffer.length} bytes) - may be stub or test payload`);
    }

    // Step 2: RSA decrypt the AES key (OAEP padding with SHA-256 MGF1)
    const aesKeyBuffer = privateDecrypt(
      {
        key: privateKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      encryptedAesKeyBuffer
    );
    if (aesKeyBuffer.length !== 16) {
      throw new Error(`Invalid AES key length after decryption: ${aesKeyBuffer.length} (expected 16)`);
    }

    // Step 3: Extract auth tag (last 16 bytes) and ciphertext
    const authTag = encryptedDataBuffer.slice(-16);
    const ciphertext = encryptedDataBuffer.slice(0, -16);

    // Step 4: AES-GCM decrypt
    const decipher = createDecipheriv("aes-128-gcm", aesKeyBuffer, ivBuffer);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    // Step 5: Parse JSON
    const decryptedData = JSON.parse(decrypted.toString("utf8"));

    // In Step 5, after JSON.parse:

// Log the exact content (add this line)
console.log(`[DEBUG] Exact decrypted JSON: ${JSON.stringify(decryptedData, null, 2)}`);  // Or use logger

logger.info(`[WhatsApp Flow] Raw decrypted JSON: ${JSON.stringify(decryptedData, null, 2)}`);

    // DEBUG: Always log the full raw decrypted JSON
    logger.info(`[WhatsApp Flow] Raw decrypted JSON: ${JSON.stringify(decryptedData, null, 2)}`);

    // Validation as warnings (non-fatal for debugging)
    if (decryptedData.action?.name !== "data_exchange") {
      logger.warn(`[WhatsApp Flow] Unexpected or missing action: ${decryptedData.action?.name || 'undefined'}. Full payload: ${JSON.stringify(decryptedData)}`);
    }

    if (!decryptedData.screen || !decryptedData.data || !decryptedData.flow_token) {
      logger.warn(`[WhatsApp Flow] Missing some expected fields (screen/data/flow_token). Available: screen=${decryptedData.screen}, hasData=${!!decryptedData.data}, hasToken=${!!decryptedData.flow_token}`);
    }

    // Return extracted fields (with fallbacks)
    return {
      screen: decryptedData.screen || 'UNKNOWN',
      data: decryptedData.data || {},
      flowToken: decryptedData.flow_token || 'unknown',
      aesKey: aesKeyBuffer,  // For response encryption
      iv: ivBuffer,  // For IV flipping in response
      ...decryptedData
    };
  } catch (error) {
    logger.error(`[WhatsApp Flow] Decryption error details: ${error.message}`);
    if (error.message.includes('bad decrypt')) {
      logger.error('Likely cause: Mismatched public/private key pair. Re-upload public key via uploadPublicKey().');
    }
    if (error.message.includes('decipher.final')) {
      logger.error('Likely cause: Invalid AES key, IV, or auth tag (wrong key or tampered data).');
    }
    throw new Error(`Failed to decrypt flow data: ${error.message}`);
  }
}

// New method: Encrypt response (AES-GCM with same key, flipped IV)
static encryptResponse(plaintextJson, aesKeyBuffer, ivBuffer) {
  try {
    // Step 1: Flip IV (bitwise NOT on each byte: ivFlipped[i] = 0xFF ^ iv[i])
    const flippedIv = Buffer.alloc(ivBuffer.length);
    for (let i = 0; i < ivBuffer.length; i++) {
      flippedIv[i] = 0xFF ^ ivBuffer[i];
    }

    // Step 2: UTF-8 encode plaintext
    const plaintextBuffer = Buffer.from(plaintextJson, "utf8");

    // Step 3: AES-GCM encrypt (no random nonce/IV here—use flipped one)
    const cipher = createCipheriv("aes-128-gcm", aesKeyBuffer, flippedIv);
    let encrypted = cipher.update(plaintextBuffer);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Step 4: Concat ciphertext + authTag
    const encryptedBuffer = Buffer.concat([encrypted, authTag]);

    // Step 5: Base64 encode
    const encryptedBase64 = encryptedBuffer.toString("base64");

    logger.info(`[WhatsApp Flow] Encrypted response length: ${encryptedBase64.length}`);
    return encryptedBase64;
  } catch (error) {
    logger.error(`[WhatsApp Flow] Encryption error: ${error.message}`);
    throw new Error(`Failed to encrypt response: ${error.message}`);
  }
}

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
                whatsapp_number: to, // Pre-fill phone field
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
        await this.handleFlowResponse(from, message.interactive.flow_token, screen, flowData);
        return;
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

  static async handleFlowResponse(from, flowToken, screen, flowData) {
    try {
      if (!flowData || !screen) {
        logger.warn(`Invalid Flow response from ${from}: Missing data or screen`);
        await this.sendMessage(from, 'Invalid Flow response. Please try again.');
        return;
      }

      if (screen === 'SIGN_UP') {
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
          whatsappId: phone,
        });

        await this.sendMessage(from, `Registration successful! Welcome, ${firstName}.`);
        logger.info(`User registered via Flow from ${from}: ${email}, flow_token: ${flowToken}`);
      } else if (screen === 'SIGN_IN') {
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
        logger.info(`User logged in via Flow from ${from}: ${identifier}, flow_token: ${flowToken}`);
      } else {
        logger.warn(`Unsupported Flow screen from ${from}: ${screen}`);
        await this.sendMessage(from, 'Unsupported Flow screen. Please try again.');
      }
    } catch (error) {
      logger.error(`Error handling Flow response from ${from}: ${error.message}`);
      await this.sendMessage(from, 'Sorry, something went wrong. Please try again.');
    }
  }
  

  static verifyWebhook(req) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      logger.info('Webhook verified successfully');
      console.log(`[WhatsApp Webhook] Verification successful, challenge: ${challenge}`);
      return challenge;
    }
    logger.warn('Webhook verification failed');
    console.log('[WhatsApp Webhook] Verification failed: Invalid verify token');
    throw new Error('Invalid verify token');
  }
}

export default WhatsAppService;





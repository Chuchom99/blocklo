// flow whatsapp service
// import fs from "fs";
// import axios from "axios";
// import crypto from "crypto";
// import prisma from "../config/prisma.js";
// import logger from "../config/logger.js";
// import UserService from "./user.service.js";
// import { langchainService } from "./ai.services.js";
// import { transcribeVoice } from "./ai.whisper.js";
// import redis from "../config/redis.js";

// class WhatsAppService {
//   // === SEND TEXT MESSAGE ===
//   static async sendMessage(to, text) {
//     try {
//       await axios.post(
//         `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
//         {
//           messaging_product: "whatsapp",
//           to,
//           type: "text",
//           text: { body: text },
//         },
//         {
//           headers: {
//             Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
//             "Content-Type": "application/json",
//           },
//         }
//       );
//       logger.info(`[WhatsApp → ${to}] ${text}`);
//     } catch (err) {
//       logger.error(
//         `[WhatsApp Send Failed] ${err.response?.data || err.message}`
//       );
//     }
//   }

//   // === SEND FLOW (SIGNUP / LOGIN) ===
//   static async sendFlow(to, flowId, flowToken = "unused") {
//     const payload = {
//       messaging_product: "whatsapp",
//       to,
//       type: "interactive",
//       interactive: {
//         type: "flow",
//         header: { type: "text", text: "Welcome to Blocklo" },
//         body: { text: "Create your account in seconds." },
//         action: {
//           name: "flow",
//           parameters: {
//             flow_message_version: "3",
//             flow_id: flowId,
//             flow_token: flowToken,
//             mode: "draft", // or "published"
//           },
//         },
//       },
//     };

//     await this.sendInteractive(payload);
//   }

//   static async sendInteractive(payload) {
//     try {
//       await axios.post(
//         `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
//         payload,
//         {
//           headers: {
//             Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
//           },
//         }
//       );
//     } catch (err) {
//       logger.error(`[Flow Send Failed] ${err.response?.data || err.message}`);
//     }
//   }

//   // === HANDLE INCOMING MESSAGE (TEXT + VOICE) ===
//   static async handleIncomingMessage(
//     from,
//     message,
//     messageId,
//     profileName = "User"
//   ) {
//     try {
//       let user = await prisma.user.findUnique({ where: { whatsappId: from } });

//       // === NEW USER → ONBOARDING FLOW ===
//       // === UNREGISTERED USER → LET AI ANSWER + OFFER SIGNUP ===
//       if (!user) {
//         let text = "";

//         if (message.type === "text") {
//           text = message.text.body.trim();
//         } else if (message.type === "audio" || message.type === "voice") {
//           const mediaId = message.audio?.id || message.voice?.id;
//           if (mediaId) {
//             await this.sendMessage(from, "Listening to your voice note...");
//             const mediaUrl = await this.getMediaUrl(mediaId);
//             text = await transcribeVoice(mediaUrl);
//             await this.sendMessage(from, `Heard: "${text}"`);
//           }
//         }

//         if (!text) {
//           await this.sendMessage(
//             from,
//             "I didn't catch that. Say hi or ask what I can do!"
//           );
//           return;
//         }

//         // LET AI ANSWER FIRST
//         const aiReply = await langchainService.processMessage(
//           from,
//           text,
//           null // userId = null → your AI should handle unregistered gracefully
//         );

//         await this.sendMessage(from, aiReply);

//         // AFTER AI replies → gently offer signup (only once per session)
//         const hasSeenWelcome = await redis.get(`welcome:${from}`);
//         if (!hasSeenWelcome) {
//           setTimeout(async () => {
//             await this.sendMessage(
//               from,
//               "\n\nReady to start banking with voice & text?\nTap below to create your account in 30 seconds"
//             );
//             await this.sendFlow(
//               from,
//               process.env.WHATSAPP_SIGNUP_FLOW_ID,
//               `onboarding_${Date.now()}`
//             );
//             await redis.setEx(`welcome:${from}`, 86400, "1"); // 24h cooldown
//           }, 2000);
//         }

//         return;
//       }

//       let text = "";

//       // === TEXT MESSAGE ===
//       if (message.type === "text") {
//         text = message.text.body.trim();
//       }

//       // === VOICE NOTE ===
//       else if (message.type === "audio" || message.type === "voice") {
//         const mediaId = message.audio?.id || message.voice?.id;
//         if (!mediaId) {
//           await this.sendMessage(
//             from,
//             "I couldn't process that voice note. Try again?"
//           );
//           return;
//         }

//         await this.sendMessage(from, "Listening to your voice note...");
//         const mediaUrl = await this.getMediaUrl(mediaId);
//         text = await transcribeVoice(mediaUrl);
//         await this.sendMessage(from, `Heard: "${text}"`);
//       }

//       // === UNSUPPORTED ===
//       else {
//         await this.sendMessage(
//           from,
//           "I only understand text and voice notes for now!"
//         );
//         return;
//       }

//       if (!text) {
//         await this.sendMessage(from, "I didn't catch that. Can you try again?");
//         return;
//       }

//       // === PROCESS WITH AI ===
//       const reply = await langchainService.processMessage(from, text, user.id);
//       await this.sendMessage(from, reply);
//     } catch (err) {
//       logger.error(`[WhatsApp Handler Error] ${err.message}`, err);
//       await this.sendMessage(
//         from,
//         "Sorry, something went wrong. Try again later."
//       );
//     }
//   }

//   // === GET MEDIA URL (VOICE NOTES) ===
//   static async getMediaUrl(mediaId) {
//     const res = await axios.get(`https://graph.facebook.com/v21.0/${mediaId}`, {
//       headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
//     });
//     return res.data.url;
//   }

//   // === DECRYPT FLOW DATA (SIGNUP / LOGIN) ===
//   static decryptFlowData(
//     encrypted_flow_data,
//     encrypted_aes_key,
//     initial_vector
//   ) {
//     const privateKey = fs.readFileSync("private_key.pem", "utf8");

//     const aesKey = crypto.privateDecrypt(
//       {
//         key: privateKey,
//         padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
//         oaepHash: "sha256",
//       },
//       Buffer.from(encrypted_aes_key, "base64")
//     );

//     const iv = Buffer.from(initial_vector, "base64");
//     const encrypted = Buffer.from(encrypted_flow_data, "base64");
//     const authTag = encrypted.slice(-16);
//     const ciphertext = encrypted.slice(0, -16);

//     const decipher = crypto.createDecipheriv("aes-128-gcm", aesKey, iv);
//     decipher.setAuthTag(authTag);

//     const decrypted = Buffer.concat([
//       decipher.update(ciphertext),
//       decipher.final(),
//     ]);
//     return JSON.parse(decrypted.toString("utf8"));
//   }

//   // === PROCESS FLOW SUBMISSION ===
//   static async processFlow(screen, data, flowToken, from) {
//     try {
//       if (screen === "SIGN_UP") {
//         const { firstName, lastName, email, phone, password, pin } = data;
//         const user = await UserService.createUser({
//           email,
//           phone,
//           firstName,
//           lastName,
//           password,
//           pin,
//           whatsappId: from,
//         });

//         await this.sendMessage(
//           from,
//           `Account created successfully, ${firstName}!\n\nYou can now send money with voice or text.`
//         );
//         return;
//       }

//       if (screen === "SIGN_IN") {
//         const { identifier, password } = data;
//         const user = await UserService.findByIdentifier(identifier);
//         if (!user || !(await UserService.verifyPassword(user.id, password))) {
//           await this.sendMessage(from, "Invalid credentials. Try again.");
//           return;
//         }
//         await prisma.user.update({
//           where: { id: user.id },
//           data: { whatsappId: from },
//         });
//         await this.sendMessage(
//           from,
//           `Welcome back, ${user.firstName}! You're logged in.`
//         );
//       }
//     } catch (err) {
//       logger.error(`[Flow Process Error] ${err.message}`);
//       await this.sendMessage(from, "Action failed. Please try again.");
//     }
//   }

//   // === VERIFY WEBHOOK (GET) ===
//   static verifyWebhook(query) {
//     const mode = query["hub.mode"];
//     const token = query["hub.verify_token"];
//     const challenge = query["hub.challenge"];

//     if (mode && token) {
//       if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
//         logger.info("[Webhook Verified]");
//         return challenge;
//       }
//     }
//     throw new Error("Forbidden");
//   }
// }

// export default WhatsAppService;

// working whatsapp service no flow and interactive

// import axios from "axios";
// import crypto from "crypto";
// import prisma from "../config/prisma.js";
// import logger from "../config/logger.js";
// import UserService from "./user.service.js";
// import { langchainService } from "./ai.services.js";
// import { transcribeVoice } from "./ai.whisper.js";
// import redis from "../config/redis.js";

// class WhatsAppService {
//   static normalizePhone(number) {
//     return number.replace(/^\+/, "");
//   }

//   static async sendMessage(to, text) {
//     const recipient = this.normalizePhone(to);
//     try {
//       await axios.post(
//         `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
//         {
//           messaging_product: "whatsapp",
//           to: recipient,
//           type: "text",
//           text: { body: text },
//         },
//         {
//           headers: {
//             Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
//             "Content-Type": "application/json",
//           },
//           timeout: 15000,
//         }
//       );
//       logger.info(`[WhatsApp → ${recipient}] ${text}`);
//     } catch (err) {
//       logger.error(`[Send Failed] ${JSON.stringify(err.response?.data || err.message)}`);
//     }
//   }

//   static async sendInteractive(payload) {
//     const recipient = this.normalizePhone(payload.to);
//     const finalPayload = { ...payload, to: recipient };

//     try {
//       await axios.post(
//         `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
//         finalPayload,
//         {
//           headers: {
//             Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
//             "Content-Type": "application/json",
//           },
//           timeout: 15000,
//         }
//       );
//       logger.info(`[Buttons Sent] → ${recipient}`);
//     } catch (err) {
//       logger.error(`[Buttons Failed] ${JSON.stringify(err.response?.data)}`);
//       await this.sendMessage(recipient, finalPayload.interactive.body.text + "\n\nReply *create account* to register");
//     }
//   }

//   static async showSignupButtons(to, name) {
//     await this.sendInteractive({
//       messaging_product: "whatsapp",
//       to,
//       type: "interactive",
//       interactive: {
//         type: "button",
//         body: { text: `Hi ${name.split(" ")[0]}! Welcome to *Blocklo Finance*\n\nCreate your account in 60 seconds — right here on WhatsApp!\n\nTap below to start` },
//         action: {
//           buttons: [
//             { type: "reply", reply: { id: "SIGNUP_START", title: "Create Account" } },
//             { type: "reply", reply: { id: "LEARN_MORE", title: "What can I do?" } },
//           ],
//         },
//       },
//     });
//   }

//   // REDIS-BASED ONBOARDING — NO PRISMA ERRORS
//   static async startInlineSignup(from, profileName) {
//     await redis.setEx(`onboarding:${from}`, 3600, JSON.stringify({
//       step: "name",
//       data: {},
//       profileName
//     }));

//     await this.sendMessage(from, `Great! Let's create your account\n\nReply with your full name (e.g. Chukwudi Okonkwo):`);
//   }

//   static async processInlineSignup(from, text) {
//     const raw = await redis.get(`onboarding:${from}`);
//     if (!raw) return false;

//     const onboarding = JSON.parse(raw);
//     let { step, data } = onboarding;

//     if (step === "name") {
//       if (text.trim().split(" ").length < 2) {
//         await this.sendMessage(from, "Please send your full name (first and last).");
//         return true;
//       }
//       const [firstName, ...rest] = text.trim().split(" ");
//       const lastName = rest.join(" ") || "User";
//       data = { ...data, firstName, lastName };

//       await redis.setEx(`onboarding:${from}`, 3600, JSON.stringify({ step: "email", data }));
//       await this.sendMessage(from, `Thanks, ${firstName}!\n\nNow send your email address:`);
//       return true;
//     }

//     if (step === "email") {
//       const email = text.trim().toLowerCase();
//       if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
//         await this.sendMessage(from, "Please send a valid email (e.g. john@gmail.com)");
//         return true;
//       }
//       data = { ...data, email };

//       await redis.setEx(`onboarding:${from}`, 3600, JSON.stringify({ step: "pin", data }));
//       await this.sendMessage(from, `Email saved!\n\nNow set your 4-digit PIN:\nReply with 4 numbers (e.g. 1234)`);
//       return true;
//     }

//     if (step === "pin") {
//       if (!/^\d{4}$/.test(text.trim())) {
//         await this.sendMessage(from, "Please reply with exactly 4 digits.");
//         return true;
//       }

//       const finalData = {
//         firstName: data.firstName,
//         lastName: data.lastName,
//         email: data.email,
//         phone: from.replace("234", "0"),
//         whatsappId: from,
//         password: crypto.randomBytes(16).toString("hex"),
//         transactionPin: text.trim(),
//         termsAgreed: true,
//         gender: 0,
//         dateOfBirth: "1990-01-01",
//         address: "Nigeria",
//         nin: "PENDING",
//         bvn: "PENDING",
//       };

//       await UserService.createUser(finalData);
//       await redis.del(`onboarding:${from}`);

//       await this.sendMessage(from,
// `Account created successfully, ${data.firstName}!

// Your Blocklo wallet is ready

// Try saying:
// • my balance
// • send 5000 to mom
// • save john 0123456789 GTBank

// Welcome aboard!`
//       );
//       return true;
//     }

//     return false;
//   }

//   static async handleIncomingMessage(rawFrom, message, messageId, profileName = "User") {
//     const from = this.normalizePhone(rawFrom);
//     const text = (message.text?.body || "").toLowerCase().trim();

//     try {
//       const user = await prisma.user.findUnique({ where: { whatsappId: from } });

//       // ONBOARDING IN PROGRESS (Redis)
//       if (await redis.get(`onboarding:${from}`)) {
//         if (message.type === "text") {
//           await this.processInlineSignup(from, message.text.body);
//         }
//         return;
//       }

//       // BUTTON: Create Account
//       if (message.interactive?.button_reply?.id === "SIGNUP_START") {
//         await this.startInlineSignup(from, profileName);
//         return;
//       }

//       // REGISTRATION KEYWORDS
//       if (["create account", "sign up", "register", "start", "open account", "join", "account"].some(k => text.includes(k))) {
//         const shown = await redis.get(`signup_shown:${from}`);
//         if (!shown) {
//           await this.showSignupButtons(from, profileName);
//           await redis.setEx(`signup_shown:${from}`, 86400, "1");
//         } else {
//           await this.startInlineSignup(from, profileName);
//         }
//         return;
//       }

//       // NORMAL CHAT
//       let inputText = message.text?.body?.trim() || "";
//       if (message.type === "audio" || message.type === "voice") {
//         const mediaId = message.audio?.id || message.voice?.id;
//         if (mediaId) {
//           await this.sendMessage(from, "Listening...");
//           const url = await this.getMediaUrl(mediaId);
//           inputText = await transcribeVoice(url);
//           await this.sendMessage(from, `Heard: "${inputText}"`);
//         }
//       }

//       const reply = await langchainService.processMessage(from, inputText || "hi", user?.id || null);
//       await this.sendMessage(from, reply);

//     } catch (err) {
//       logger.error(`[Handler Error] ${err.message}`);
//       await this.sendMessage(from, "Sorry, something went wrong. Say *create account* to register on WhatsApp.");
//     }
//   }

//   static async getMediaUrl(mediaId) {
//     const res = await axios.get(`https://graph.facebook.com/v21.0/${mediaId}`, {
//       headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
//     });
//     return res.data.url;
//   }

//   static verifyWebhook(query) {
//     if (query["hub.mode"] === "subscribe" && query["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN) {
//       logger.info("[Webhook Verified]");
//       return query["hub.challenge"];
//     }
//     throw new Error("Forbidden");
//   }
// }

// export default WhatsAppService;

// import axios from "axios";
// import crypto from "crypto";
// import prisma from "../config/prisma.js";
// import logger from "../config/logger.js";
// import UserService from "./user.service.js";
// import { langchainService } from "./ai.services.js";
// import { transcribeVoice } from "./ai.whisper.js";
// import redis from "../config/redis.js";

// class WhatsAppService {
//   static normalizePhone(number) {
//     return number.replace(/^\+/, "");
//   }

//   static async sendMessage(to, text) {
//     const recipient = this.normalizePhone(to);
//     await axios
//       .post(
//         `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
//         {
//           messaging_product: "whatsapp",
//           to: recipient,
//           type: "text",
//           text: { body: text },
//         },
//         {
//           headers: {
//             Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
//             "Content-Type": "application/json",
//           },
//           timeout: 15000,
//         }
//       )
//       .catch((err) => logger.error("Send failed:", err.response?.data));
//   }

//   static async sendInteractive(payload) {
//     const recipient = this.normalizePhone(payload.to);
//     const finalPayload = { ...payload, to: recipient };

//     await axios
//       .post(
//         `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
//         finalPayload,
//         {
//           headers: {
//             Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
//             "Content-Type": "application/json",
//           },
//           timeout: 15000,
//         }
//       )
//       .catch((err) => {
//         logger.error("Interactive failed:", err.response?.data);
//         this.sendMessage(
//           recipient,
//           finalPayload.interactive?.body?.text || "Please continue."
//         );
//       });
//   }

//   static async showWelcomeButton(to, name) {
//     await this.sendInteractive({
//       messaging_product: "whatsapp",
//       to,
//       type: "interactive",
//       interactive: {
//         type: "button",
//         body: {
//           text: `Hi ${
//             name.split(" ")[0]
//           }! Welcome to *Blocklo Finance*\n\nCreate your account in 60 seconds — right here on WhatsApp!`,
//         },
//         action: {
//           buttons: [
//             {
//               type: "reply",
//               reply: { id: "START_SIGNUP", title: "Create Account" },
//             },
//             {
//               type: "reply",
//               reply: { id: "LEARN_MORE", title: "What can I do?" },
//             },
//           ],
//         },
//       },
//     });
//   }

//   static async startSignupFlow(from, profileName) {
//     await redis.setEx(
//       `onboarding:${from}`,
//       3600,
//       JSON.stringify({
//         step: "gender",
//         data: { profileName },
//       })
//     );

//     await this.sendInteractive({
//       messaging_product: "whatsapp",
//       to: from,
//       type: "interactive",
//       interactive: {
//         type: "button",
//         body: {
//           text: "Let's create your Blocklo account\n\nFirst, select your gender:",
//         },
//         action: {
//           buttons: [
//             { type: "reply", reply: { id: "GENDER_MALE", title: "Male" } },
//             { type: "reply", reply: { id: "GENDER_FEMALE", title: "Female" } },
//           ],
//         },
//       },
//     });
//   }

//   static async handleOnboarding(from, message) {
//     const raw = await redis.get(`onboarding:${from}`);
//     if (!raw) return false;
//     const state = JSON.parse(raw);
//     let { step, data } = state;

//     // GENDER
//     if (message.interactive?.button_reply?.id?.startsWith("GENDER_")) {
//       data.gender =
//         message.interactive.button_reply.id === "GENDER_MALE" ? 0 : 1;

//       await redis.setEx(
//         `onboarding:${from}`,
//         3600,
//         JSON.stringify({ step: "name", data })
//       );
//       await this.sendMessage(
//         from,
//         "What's your full name?\n(e.g. Chukwudi Okonkwo)"
//       );
//       return true;
//     }

//     // NAME
//     if (step === "name" && message.text?.body) {
//       const name = message.text.body.trim();
//       if (name.split(" ").length < 2)
//         return (
//           this.sendMessage(from, "Please send full name (first + last)."), true
//         );
//       const [firstName, ...rest] = name.split(" ");
//       data.firstName = firstName;
//       data.lastName = rest.join(" ") || "User";

//       await redis.setEx(
//         `onboarding:${from}`,
//         3600,
//         JSON.stringify({ step: "email", data })
//       );
//       await this.sendMessage(
//         from,
//         `Thanks, ${firstName}!\n\nNow send your email address:`
//       );
//       return true;
//     }

//     // EMAIL
//     if (step === "email" && message.text?.body) {
//       const email = message.text.body.trim().toLowerCase();
//       if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
//         return this.sendMessage(from, "Invalid email. Try again:"), true;
//       data.email = email;

//       await redis.setEx(
//         `onboarding:${from}`,
//         3600,
//         JSON.stringify({ step: "dob", data })
//       );
//       await this.sendMessage(
//         from,
//         "What's your date of birth?\nReply in this format: dd/mm/yyyy\n(e.g. 15/08/1995)"
//       );
//       return true;
//     }

//     // DOB
//     if (step === "dob" && message.text?.body) {
//       const dob = message.text.body.trim();
//       if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dob))
//         return (
//           this.sendMessage(
//             from,
//             "Please use format: dd/mm/yyyy\n(e.g. 21/09/1993)"
//           ),
//           true
//         );
//       data.dateOfBirth = dob;

//       await redis.setEx(
//         `onboarding:${from}`,
//         3600,
//         JSON.stringify({ step: "address", data })
//       );
//       await this.sendMessage(
//         from,
//         "What's your residential address?\n(e.g. 12 Adeola Odeku, Victoria Island, Lagos)"
//       );
//       return true;
//     }

//     // ADDRESS
//     if (step === "address" && message.text?.body) {
//       data.address = message.text.body.trim();

//       await redis.setEx(
//         `onboarding:${from}`,
//         3600,
//         JSON.stringify({ step: "nin", data })
//       );
//       await this.sendMessage(
//         from,
//         "Please send your 11-digit NIN:\n(e.g. 12345678901)"
//       );
//       return true;
//     }

//     // NIN
//     if (step === "nin" && message.text?.body) {
//       const nin = message.text.body.trim();
//       if (!/^\d{11}$/.test(nin))
//         return this.sendMessage(from, "NIN must be 11 digits."), true;
//       data.nin = nin;

//       await redis.setEx(
//         `onboarding:${from}`,
//         3600,
//         JSON.stringify({ step: "bvn", data })
//       );
//       await this.sendMessage(
//         from,
//         "Please send your 11-digit BVN:\n(e.g. 22345678901)"
//       );
//       return true;
//     }

//     // BVN
//     if (step === "bvn" && message.text?.body) {
//       const bvn = message.text.body.trim();
//       if (!/^\d{11}$/.test(bvn))
//         return this.sendMessage(from, "BVN must be 11 digits."), true;
//       data.bvn = bvn;

//       await redis.setEx(
//         `onboarding:${from}`,
//         3600,
//         JSON.stringify({ step: "pin", data })
//       );
//       await this.sendMessage(
//         from,
//         `Almost done!\n\nNow set your 4-digit transaction PIN:\nReply with 4 numbers (e.g. 1234)\n\nYour PIN will be hidden`
//       );
//       return true;
//     }

//     // PIN
//     if (step === "pin" && message.text?.body) {
//       const pin = message.text.body.trim();
//       if (!/^\d{4}$/.test(pin))
//         return (
//           this.sendMessage(from, "Please reply with exactly 4 digits."), true
//         );

//       const finalData = {
//         email: data.email,
//         phone: from.replace("234", "0"),
//         whatsappId: from,
//         firstName: data.firstName,
//         lastName: data.lastName,
//         password: crypto.randomBytes(20).toString("hex"),
//         pin: pin,
//         termsAgreed: true,
//         gender: data.gender,
//         dateOfBirth: data.dateOfBirth, // Already in dd/mm/yyyy
//         address: data.address,
//         nin: data.nin,
//         bvn: data.bvn,
//         ninUserId: "PENDING", // or generate if needed
//       };

//       try {
//         await UserService.createUser(finalData);
//         await redis.del(`onboarding:${from}`);

//         await this.sendMessage(
//           from,
//           `Account created successfully, ${data.firstName}!

// Your Blocklo + 9PSB wallet is being activated...

// You can now:
// • Check balance
// • Send money
// • Buy airtime
// • Pay bills

// Welcome to the future of banking on WhatsApp!`
//         );
//       } catch (err) {
//         logger.error("User creation failed:", err.message);
//         await this.sendMessage(
//           from,
//           "Account creation failed. Please try again later."
//         );
//       }
//       return true;
//     }

//     return false;
//   }

//   static async handleIncomingMessage(
//     rawFrom,
//     message,
//     messageId,
//     profileName = "User"
//   ) {
//     const from = this.normalizePhone(rawFrom);

//     try {
//       const user = await prisma.user.findUnique({
//         where: { whatsappId: from },
//       });

//       // ONBOARDING IN PROGRESS
//       if (await redis.get(`onboarding:${from}`)) {
//         await this.handleOnboarding(from, message);
//         return;
//       }

//       // BUTTONS
//       if (message.interactive?.button_reply?.id === "START_SIGNUP") {
//         await this.startSignupFlow(from, profileName);
//         return;
//       }
//       if (message.interactive?.button_reply?.id === "LEARN_MORE") {
//         await this.sendMessage(
//           from,
//           "With Blocklo you can bank on WhatsApp:\n• Send money\n• Check balance\n• Buy airtime\n• Pay bills\nNo app needed!\n\nReady to join?"
//         );
//         return;
//       }

//       // KEYWORDS
//       const text = (message.text?.body || "").toLowerCase();
//       if (
//         [
//           "create account",
//           "register",
//           "sign up",
//           "start",
//           "join",
//           "open account",
//           "account",
//         ].some((k) => text.includes(k))
//       ) {
//         await this.showWelcomeButton(from, profileName);
//         return;
//       }

//       // NORMAL AI CHAT
//       let input = message.text?.body?.trim() || "";
//       if (message.type === "audio" || message.type === "voice") {
//         const mediaId = message.audio?.id || message.voice?.id;
//         if (mediaId) {
//           await this.sendMessage(from, "Listening...");
//           const url = await this.getMediaUrl(mediaId);
//           input = await transcribeVoice(url);
//           await this.sendMessage(from, `Heard: "${input}"`);
//         }
//       }

//       const reply = await langchainService.processMessage(
//         from,
//         input || "hi",
//         user?.id || null
//       );
//       await this.sendMessage(from, reply);
//     } catch (err) {
//       logger.error("Handler error:", err);
//       await this.sendMessage(
//         from,
//         "Sorry, something went wrong. Say *create account* to register."
//       );
//     }
//   }

//   static async getMediaUrl(mediaId) {
//     const res = await axios.get(`https://graph.facebook.com/v21.0/${mediaId}`, {
//       headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
//     });
//     return res.data.url;
//   }

//   static verifyWebhook(query) {
//     if (
//       query["hub.mode"] === "subscribe" &&
//       query["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN
//     ) {
//       return query["hub.challenge"];
//     }
//     throw new Error("Forbidden");
//   }
// }

// export default WhatsAppService;

// FINAL 100% WORKING VERSION — NO MORE ERRORS
// import axios from "axios";
// import crypto from "crypto";
// import prisma from "../config/prisma.js";
// import logger from "../config/logger.js";
// import UserService from "./user.service.js";
// import { langchainService } from "./ai.services.js";
// import { transcribeVoice } from "./ai.whisper.js";
// import redis from "../config/redis.js";

// class WhatsAppService {
//   static normalizePhone(number) {
//     return number.replace(/^\+/, "");
//   }

//   // ROBUST SEND MESSAGE WITH RETRY
//   static async sendMessage(to, text) {
//     const recipient = this.normalizePhone(to);
//     const payload = {
//       messaging_product: "whatsapp",
//       to: recipient,
//       type: "text",
//       text: { body: text },
//     };

//     for (let i = 0; i < 3; i++) {
//       try {
//         await axios.post(
//           `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
//           payload,
//           {
//             headers: {
//               Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
//               "Content-Type": "application/json",
//             },
//             timeout: 10000,
//           }
//         );
//         logger.info(`[WhatsApp → ${recipient}] ${text}`);
//         return;
//       } catch (err) {
//         const error = err.response?.data || err.message;
//         logger.error(`Send attempt ${i + 1} failed:`, error);

//         if (error?.error?.code === 131009 || error?.error?.code === 131051) {
//           // Token expired or invalid
//           logger.error("WhatsApp token expired or invalid!");
//           break;
//         }
//         if (i === 2) {
//           logger.error("All send attempts failed for:", recipient);
//         }
//         await new Promise((r) => setTimeout(r, 2000));
//       }
//     }

//     // Final fallback
//     logger.error(`FAILED to send to ${recipient}: ${text}`);
//   }

//   static async sendInteractive(payload) {
//     const recipient = this.normalizePhone(payload.to);
//     const finalPayload = { ...payload, to: recipient };

//     try {
//       await axios.post(
//         `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
//         finalPayload,
//         {
//           headers: {
//             Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
//             "Content-Type": "application/json",
//           },
//           timeout: 10000,
//         }
//       );
//       logger.info(`[Interactive → ${recipient}] Sent`);
//     } catch (err) {
//       logger.error("Interactive failed:", err.response?.data || err.message);
//       await this.sendMessage(
//         recipient,
//         "Please reply with your info to continue registration."
//       );
//     }
//   }

//   static async showWelcomeButton(to, name) {
//     await this.sendInteractive({
//       messaging_product: "whatsapp",
//       to,
//       type: "interactive",
//       interactive: {
//         type: "button",
//         body: {
//           text: `Hi ${
//             name.split(" ")[0]
//           }! Welcome to *Blocklo Finance*\n\nCreate your account in 60 seconds — right here on WhatsApp!`,
//         },
//         action: {
//           buttons: [
//             {
//               type: "reply",
//               reply: { id: "START_SIGNUP", title: "Create Account" },
//             },
//             {
//               type: "reply",
//               reply: { id: "LEARN_MORE", title: "What can I do?" },
//             },
//           ],
//         },
//       },
//     });
//   }

//   static async startSignupFlow(from, profileName) {
//     await redis.setEx(
//       `onboarding:${from}`,
//       3600,
//       JSON.stringify({
//         step: "gender",
//         data: { profileName },
//       })
//     );

//     await this.sendInteractive({
//       messaging_product: "whatsapp",
//       to: from,
//       type: "interactive",
//       interactive: {
//         type: "button",
//         body: {
//           text: "Let's create your Blocklo account\n\nFirst, select your gender:",
//         },
//         action: {
//           buttons: [
//             { type: "reply", reply: { id: "GENDER_MALE", title: "Male" } },
//             { type: "reply", reply: { id: "GENDER_FEMALE", title: "Female" } },
//           ],
//         },
//       },
//     });
//   }

//   static async handleOnboarding(from, message) {
//     const redisKey = `onboarding:${from}`;
//     const raw = await redis.get(redisKey);

//     // IF USER SENDS ANYTHING AFTER FAILURE → FORCE FULL RESET
//     if (!raw || message.text?.body?.trim().toLowerCase() === "start over") {
//       await redis.del(redisKey);
//       await this.sendMessage(from, "Starting fresh registration...");
//       await this.startSignupFlow(from, "User");
//       return true;
//     }

//     const state = JSON.parse(raw);
//     let { step, data } = state;

//     // === GENDER ===
//     if (message.interactive?.button_reply?.id?.startsWith("GENDER_")) {
//       data.gender =
//         message.interactive.button_reply.id === "GENDER_MALE" ? 0 : 1;
//       await redis.setEx(redisKey, 3600, JSON.stringify({ step: "name", data }));
//       await this.sendMessage(
//         from,
//         "What's your full name?\n(e.g. Chukwudi Okonkwo)"
//       );
//       return true;
//     }

//     // === NAME ===
//     if (step === "name" && message.text?.body) {
//       const name = message.text.body.trim();
//       if (name.split(" ").length < 2) {
//         await this.sendMessage(
//           from,
//           "Please send your full name (first + last)."
//         );
//         return true;
//       }
//       const [firstName, ...rest] = name.split(" ");
//       data.firstName = firstName;
//       data.lastName = rest.join(" ") || "User";

//       await redis.setEx(
//         redisKey,
//         3600,
//         JSON.stringify({ step: "email", data })
//       );
//       await this.sendMessage(
//         from,
//         `Thanks, ${firstName}!\n\nNow send your email address:`
//       );
//       return true;
//     }

//     // === EMAIL ===
//     if (step === "email" && message.text?.body) {
//       const email = message.text.body.trim().toLowerCase();
//       if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
//         await this.sendMessage(from, "Invalid email. Try again:");
//         return true;
//       }
//       data.email = email;

//       await redis.setEx(redisKey, 3600, JSON.stringify({ step: "dob", data }));
//       await this.sendMessage(
//         from,
//         "Date of birth? (dd/mm/yyyy)\ne.g. 15/08/1995"
//       );
//       return true;
//     }

//     // === DOB ===
//     if (step === "dob" && message.text?.body) {
//       const dob = message.text.body.trim();
//       if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dob)) {
//         await this.sendMessage(from, "Use format: dd/mm/yyyy");
//         return true;
//       }
//       data.dateOfBirth = dob;

//       await redis.setEx(
//         redisKey,
//         3600,
//         JSON.stringify({ step: "address", data })
//       );
//       await this.sendMessage(
//         from,
//         "Your residential address?\n(e.g. 12 Adeola Odeku, Victoria Island, Lagos)"
//       );
//       return true;
//     }

//     // === ADDRESS ===
//     if (step === "address" && message.text?.body) {
//       data.address = message.text.body.trim();

//       await redis.setEx(redisKey, 3600, JSON.stringify({ step: "nin", data }));
//       await this.sendMessage(from, "Your 11-digit NIN:");
//       return true;
//     }

//     // === NIN ===
//     if (step === "nin" && message.text?.body) {
//       const nin = message.text.body.trim();
//       if (!/^\d{11}$/.test(nin)) {
//         await this.sendMessage(
//           from,
//           "NIN must be 11 digits: \n(e.g. 12345678901)"
//         );
//         return true;
//       }
//       data.nin = nin;

//       await redis.setEx(redisKey, 3600, JSON.stringify({ step: "bvn", data }));
//       await this.sendMessage(from, "Your 11-digit BVN: \n(e.g. 22345678901)");
//       return true;
//     }

//     // === BVN ===
//     if (step === "bvn" && message.text?.body) {
//       const bvn = message.text.body.trim();
//       if (!/^\d{11}$/.test(bvn)) {
//         await this.sendMessage(from, "BVN must be 11 digits.");
//         return true;
//       }
//       data.bvn = bvn;

//       await redis.setEx(redisKey, 3600, JSON.stringify({ step: "pin", data }));
//       await this.sendMessage(
//         from,
//         `Almost done!\n\nSet your 4-digit PIN:\n(e.g. 1234)`
//       );
//       return true;
//     }

//     // === FINAL: PIN → DESTROY REDIS + FRESH DATA ONLY ===
//     if (step === "pin" && message.text?.body) {
//       const pin = message.text.body.trim();
//       if (!/^\d{4}$/.test(pin)) {
//         await this.sendMessage(from, "Please reply with exactly 4 digits.");
//         return true;
//       }

//       // CRITICAL: DELETE REDIS NOW — NO CHANCE OF REUSING OLD DATA
//       await redis.del(redisKey);

//       // Fresh ninUserId — generated NOW
//       const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
//       let prefix = "";
//       for (let i = 0; i < 6; i++)
//         prefix += letters[Math.floor(Math.random() * 26)];
//       const ninUserId =
//         prefix + "-" + String(Math.floor(1000 + Math.random() * 9000));

//       const finalData = {
//         email: data.email,
//         phone: from.replace("234", "0"),
//         whatsappId: from,
//         firstName: data.firstName,
//         lastName: data.lastName,
//         password: crypto.randomBytes(20).toString("hex"),
//         pin,
//         termsAgreed: true,
//         gender: data.gender,
//         dateOfBirth: data.dateOfBirth,
//         address: data.address,
//         nin: data.nin,
//         bvn: data.bvn,
//         ninUserId,
//       };

//       try {
//         const result = await UserService.createUser(finalData);
//         const accountNumber = result.accountNumber;

//         await this.sendMessage(
//           from,
//           `Account created successfully, ${result.firstName}!

// Your 9PSB Wallet is LIVE

// Account Number: ${accountNumber || "11000XXXXX"}
// Bank: 9 Payment Service Bank (9PSB)

// Say *balance* to check your money

// Welcome to Blocklo`
//         );
//       } catch (err) {
//         const msg = err.message || "";
//         if (msg.includes("Wallet Already Exists") || msg.includes("42")) {
//           await this.sendMessage(
//             from,
//             "This NIN/BVN already has a wallet. Use different details."
//           );
//         } else {
//           await this.sendMessage(
//             from,
//             "Registration failed. Say *start over* to try again."
//           );
//         }
//       }
//       return true;
//     }

//     return false;
//   }

//   static async handleIncomingMessage(
//     rawFrom,
//     message,
//     messageId,
//     profileName = "User"
//   ) {
//     const from = this.normalizePhone(rawFrom);

//     // EARLY CHECK: Is user registered?
//     const userContext = await langchainService.getUserContext(from);

//     if (!userContext) {
//       // Not registered → force onboarding
//       await this.sendMessage(
//         from,
//         `Hi${profileName ? " " + profileName.split(" ")[0] : ""}!

// I see you haven't created your Blocklo × 9PSB wallet yet.

// Say *create account* to open your bank account in 60 seconds — right here on WhatsApp!`
//       );
//       return;
//     }

//     try {
//       if (await redis.get(`onboarding:${from}`)) {
//         await this.handleOnboarding(from, message);
//         return;
//       }

//       if (message.interactive?.button_reply?.id === "START_SIGNUP") {
//         await this.startSignupFlow(from, profileName);
//         return;
//       }

//       if (message.interactive?.button_reply?.id === "LEARN_MORE") {
//         await this.sendMessage(
//           from,
//           "With Blocklo you can:\n• Send money\n• Check balance\n• Buy airtime\n• Pay bills\nAll on WhatsApp!\n\nSay *create account* to start"
//         );
//         return;
//       }

//       const text = (message.text?.body || "").toLowerCase();
//       if (
//         [
//           "create account",
//           "register",
//           "sign up",
//           "open account",
//           "account",
//         ].some((k) => text.includes(k))
//       ) {
//         await this.showWelcomeButton(from, profileName);
//         return;
//       }

//       // Normal AI chat
//       let input = message.text?.body?.trim() || "";
//       if (message.type === "audio" || message.type === "voice") {
//         const mediaId = message.audio?.id || message.voice?.id;
//         if (mediaId) {
//           await this.sendMessage(from, "Listening...");
//           const url = await this.getMediaUrl(mediaId);
//           input = await transcribeVoice(url);
//         }
//       }

//       const reply = await langchainService.processMessage(
//         from,
//         input || "hi",
//         null
//       );
//       await this.sendMessage(from, reply);
//     } catch (err) {
//       logger.error("Handler error:", err);
//       await this.sendMessage(
//         from,
//         "Sorry, something went wrong. Say *create account* to register."
//       );
//     }
//   }

//   static async getMediaUrl(mediaId) {
//     const res = await axios.get(`https://graph.facebook.com/v21.0/${mediaId}`, {
//       headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
//     });
//     return res.data.url;
//   }

//   static verifyWebhook(query) {
//     if (
//       query["hub.mode"] === "subscribe" &&
//       query["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN
//     ) {
//       return query["hub.challenge"];
//     }
//     throw new Error("Forbidden");
//   }
// }

// export default WhatsAppService;

// import axios from "axios";
// import crypto from "crypto";
// import prisma from "../config/prisma.js";
// import logger from "../config/logger.js";
// import UserService from "./user.service.js";
// import { langchainService } from "./ai.services.js";
// import { transcribeVoice } from "./ai.whisper.js";
// import redis from "../config/redis.js";

// class WhatsAppService {
//   static normalizePhone(number) {
//     return number.replace(/^\+/, "");
//   }

//   // ROBUST SEND MESSAGE WITH RETRY
//   static async sendMessage(to, text) {
//     const recipient = this.normalizePhone(to);
//     const payload = {
//       messaging_product: "whatsapp",
//       to: recipient,
//       type: "text",
//       text: { body: text },
//     };

//     for (let i = 0; i < 3; i++) {
//       try {
//         await axios.post(
//           `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
//           payload,
//           {
//             headers: {
//               Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
//               "Content-Type": "application/json",
//             },
//             timeout: 10000,
//           }
//         );
//         logger.info(`[WhatsApp → ${recipient}] ${text}`);
//         return;
//       } catch (err) {
//         const error = err.response?.data || err.message;
//         logger.error(`Send attempt ${i + 1} failed:`, error);

//         if (error?.error?.code === 131009 || error?.error?.code === 131051) {
//           // Token expired or invalid
//           logger.error("WhatsApp token expired or invalid!");
//           break;
//         }
//         if (i === 2) {
//           logger.error("All send attempts failed for:", recipient);
//         }
//         await new Promise((r) => setTimeout(r, 2000));
//       }
//     }

//     // Final fallback
//     logger.error(`FAILED to send to ${recipient}: ${text}`);
//   }

//   static async sendInteractive(payload) {
//     const recipient = this.normalizePhone(payload.to);
//     const finalPayload = { ...payload, to: recipient };

//     try {
//       await axios.post(
//         `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
//         finalPayload,
//         {
//           headers: {
//             Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
//             "Content-Type": "application/json",
//           },
//           timeout: 10000,
//         }
//       );
//       logger.info(`[Interactive → ${recipient}] Sent`);
//     } catch (err) {
//       logger.error("Interactive failed:", err.response?.data || err.message);
//       await this.sendMessage(
//         recipient,
//         "Please reply with your info to continue registration."
//       );
//     }
//   }

//   static async showWelcomeButton(to, name) {
//     await this.sendInteractive({
//       messaging_product: "whatsapp",
//       to,
//       type: "interactive",
//       interactive: {
//         type: "button",
//         body: {
//           text: `Hi ${
//             name.split(" ")[0]
//           }! Welcome to *Blocklo Finance*\n\nCreate your account in 60 seconds — right here on WhatsApp!`,
//         },
//         action: {
//           buttons: [
//             {
//               type: "reply",
//               reply: { id: "START_SIGNUP", title: "Create Account" },
//             },
//             {
//               type: "reply",
//               reply: { id: "LEARN_MORE", title: "What can I do?" },
//             },
//           ],
//         },
//       },
//     });
//   }

//   static async startSignupFlow(from, profileName) {
//     await redis.setEx(
//       `onboarding:${from}`,
//       3600,
//       JSON.stringify({
//         step: "gender",
//         data: { profileName },
//       })
//     );

//     await this.sendInteractive({
//       messaging_product: "whatsapp",
//       to: from,
//       type: "interactive",
//       interactive: {
//         type: "button",
//         body: {
//           text: "Let's create your Blocklo account\n\nFirst, select your gender:",
//         },
//         action: {
//           buttons: [
//             { type: "reply", reply: { id: "GENDER_MALE", title: "Male" } },
//             { type: "reply", reply: { id: "GENDER_FEMALE", title: "Female" } },
//           ],
//         },
//       },
//     });
//   }

//   static async handleOnboarding(from, message) {
//     const redisKey = `onboarding:${from}`;
//     const raw = await redis.get(redisKey);

//     // IF USER SENDS ANYTHING AFTER FAILURE → FORCE FULL RESET
//     if (!raw || message.text?.body?.trim().toLowerCase() === "start over") {
//       await redis.del(redisKey);
//       await this.sendMessage(from, "Starting fresh registration...");
//       await this.startSignupFlow(from, "User");
//       return true;
//     }

//     const state = JSON.parse(raw);
//     let { step, data } = state;

//     // === GENDER ===
//     if (message.interactive?.button_reply?.id?.startsWith("GENDER_")) {
//       data.gender =
//         message.interactive.button_reply.id === "GENDER_MALE" ? 0 : 1;
//       await redis.setEx(redisKey, 3600, JSON.stringify({ step: "name", data }));
//       await this.sendMessage(
//         from,
//         "What's your full name?\n(e.g. Chukwudi Okonkwo)"
//       );
//       return true;
//     }

//     // === NAME ===
//     if (step === "name" && message.text?.body) {
//       const name = message.text.body.trim();
//       if (name.split(" ").length < 2) {
//         await this.sendMessage(
//           from,
//           "Please send your full name (first + last)."
//         );
//         return true;
//       }
//       const [firstName, ...rest] = name.split(" ");
//       data.firstName = firstName;
//       data.lastName = rest.join(" ") || "User";

//       await redis.setEx(
//         redisKey,
//         3600,
//         JSON.stringify({ step: "email", data })
//       );
//       await this.sendMessage(
//         from,
//         `Thanks, ${firstName}!\n\nNow send your email address:`
//       );
//       return true;
//     }

//     // === EMAIL ===
//     if (step === "email" && message.text?.body) {
//       const email = message.text.body.trim().toLowerCase();
//       if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
//         await this.sendMessage(from, "Invalid email. Try again:");
//         return true;
//       }
//       data.email = email;

//       await redis.setEx(redisKey, 3600, JSON.stringify({ step: "dob", data }));
//       await this.sendMessage(
//         from,
//         "Date of birth? (dd/mm/yyyy)\ne.g. 15/08/1995"
//       );
//       return true;
//     }

//     // === DOB ===
//     if (step === "dob" && message.text?.body) {
//       const dob = message.text.body.trim();
//       if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dob)) {
//         await this.sendMessage(from, "Use format: dd/mm/yyyy");
//         return true;
//       }
//       data.dateOfBirth = dob;

//       await redis.setEx(
//         redisKey,
//         3600,
//         JSON.stringify({ step: "address", data })
//       );
//       await this.sendMessage(
//         from,
//         "Your residential address?\n(e.g. 12 Adeola Odeku, Victoria Island, Lagos)"
//       );
//       return true;
//     }

//     // === ADDRESS ===
//     if (step === "address" && message.text?.body) {
//       data.address = message.text.body.trim();

//       await redis.setEx(redisKey, 3600, JSON.stringify({ step: "nin", data }));
//       await this.sendMessage(from, "Your 11-digit NIN:");
//       return true;
//     }

//     // === NIN ===
//     if (step === "nin" && message.text?.body) {
//       const nin = message.text.body.trim();
//       if (!/^\d{11}$/.test(nin)) {
//         await this.sendMessage(
//           from,
//           "NIN must be 11 digits: \n(e.g. 12345678901)"
//         );
//         return true;
//       }
//       data.nin = nin;

//       await redis.setEx(redisKey, 3600, JSON.stringify({ step: "bvn", data }));
//       await this.sendMessage(from, "Your 11-digit BVN: \n(e.g. 22345678901)");
//       return true;
//     }

//     // === BVN ===
//     if (step === "bvn" && message.text?.body) {
//       const bvn = message.text.body.trim();
//       if (!/^\d{11}$/.test(bvn)) {
//         await this.sendMessage(from, "BVN must be 11 digits.");
//         return true;
//       }
//       data.bvn = bvn;

//       await redis.setEx(redisKey, 3600, JSON.stringify({ step: "pin", data }));
//       await this.sendMessage(
//         from,
//         `Almost done!\n\nSet your 4-digit PIN:\n(e.g. 1234)`
//       );
//       return true;
//     }

//     // === FINAL: PIN → DESTROY REDIS + FRESH DATA ONLY ===
//     if (step === "pin" && message.text?.body) {
//       const pin = message.text.body.trim();
//       if (!/^\d{4}$/.test(pin)) {
//         await this.sendMessage(from, "Please reply with exactly 4 digits.");
//         return true;
//       }

//       // CRITICAL: DELETE REDIS NOW — NO CHANCE OF REUSING OLD DATA
//       await redis.del(redisKey);

//       // Fresh ninUserId — generated NOW
//       const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
//       let prefix = "";
//       for (let i = 0; i < 6; i++)
//         prefix += letters[Math.floor(Math.random() * 26)];
//       const ninUserId =
//         prefix + "-" + String(Math.floor(1000 + Math.random() * 9000));

//       const finalData = {
//         email: data.email,
//         phone: from.replace("234", "0"),
//         whatsappId: from,
//         firstName: data.firstName,
//         lastName: data.lastName,
//         password: crypto.randomBytes(20).toString("hex"),
//         pin,
//         termsAgreed: true,
//         gender: data.gender,
//         dateOfBirth: data.dateOfBirth,
//         address: data.address,
//         nin: data.nin,
//         bvn: data.bvn,
//         ninUserId,
//       };

//       try {
//         const result = await UserService.createUser(finalData);
//         const accountNumber = result.accountNumber;

//         await this.sendMessage(
//           from,
//           `Account created successfully, ${result.firstName}!

// Your 9PSB Wallet is LIVE

// Account Number: ${accountNumber || "11000XXXXX"}
// Bank: 9 Payment Service Bank (9PSB)

// Say *balance* to check your money

// Welcome to Blocklo`
//         );
//       } catch (err) {
//         const msg = err.message || "";
//         if (msg.includes("Wallet Already Exists") || msg.includes("42")) {
//           await this.sendMessage(
//             from,
//             "This NIN/BVN already has a wallet. Use different details."
//           );
//         } else {
//           await this.sendMessage(
//             from,
//             "Registration failed. Say *start over* to try again."
//           );
//         }
//       }
//       return true;
//     }

//     return false;
//   }

//   static async handleIncomingMessage(
//     rawFrom,
//     message,
//     messageId,
//     profileName = "User"
//   ) {
//     const from = this.normalizePhone(rawFrom);

//     // EARLY CHECK: Is user registered?
//     const userContext = await langchainService.getUserContext(from);

//     if (!userContext) {
//       // Not registered → force onboarding
//       await this.sendMessage(
//         from,
//         `Hi${profileName ? " " + profileName.split(" ")[0] : ""}!

// I see you haven't created your Blocklo × 9PSB wallet yet.

// Say *create account* to open your bank account in 60 seconds — right here on WhatsApp!`
//       );
//       return;
//     }

//     try {
//       if (await redis.get(`onboarding:${from}`)) {
//         await this.handleOnboarding(from, message);
//         return;
//       }

//       if (message.interactive?.button_reply?.id === "START_SIGNUP") {
//         await this.startSignupFlow(from, profileName);
//         return;
//       }

//       if (message.interactive?.button_reply?.id === "LEARN_MORE") {
//         await this.sendMessage(
//           from,
//           "With Blocklo you can:\n• Send money\n• Check balance\n• Buy airtime\n• Pay bills\nAll on WhatsApp!\n\nSay *create account* to start"
//         );
//         return;
//       }

//       const text = (message.text?.body || "").toLowerCase();
//       if (
//         [
//           "create account",
//           "register",
//           "sign up",
//           "open account",
//           "account",
//         ].some((k) => text.includes(k))
//       ) {
//         await this.showWelcomeButton(from, profileName);
//         return;
//       }

//       // Normal AI chat
//       let input = message.text?.body?.trim() || "";
//       if (message.type === "audio" || message.type === "voice") {
//         const mediaId = message.audio?.id || message.voice?.id;
//         if (mediaId) {
//           await this.sendMessage(from, "Listening...");
//           const url = await this.getMediaUrl(mediaId);
//           input = await transcribeVoice(url);
//         }
//       }

//       const reply = await langchainService.processMessage(
//         from,
//         input || "hi",
//         null
//       );
//       await this.sendMessage(from, reply);
//     } catch (err) {
//       logger.error("Handler error:", err);
//       await this.sendMessage(
//         from,
//         "Sorry, something went wrong. Say *create account* to register."
//       );
//     }
//   }

//   static async getMediaUrl(mediaId) {
//     const res = await axios.get(`https://graph.facebook.com/v21.0/${mediaId}`, {
//       headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
//     });
//     return res.data.url;
//   }

//   static verifyWebhook(query) {
//     if (
//       query["hub.mode"] === "subscribe" &&
//       query["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN
//     ) {
//       return query["hub.challenge"];
//     }
//     throw new Error("Forbidden");
//   }
// }

// export default WhatsAppService;

// src/services/whatsapp.service.js
import axios from "axios";
import logger from "../config/logger.js";
import { langchainService } from "./ai.services.js";
import fs from "fs"; 
import crypto from "crypto";

class WhatsAppService {
  static normalizePhone(number) {
    return number.toString().replace(/[^\d]/g, "").replace(/^234/, "234");
  }

  // === DECRYPT FLOW DATA (SIGNUP / LOGIN) ===
static decryptFlowData(encrypted_flow_data, encrypted_aes_key, initial_vector) {
  const privateKeyPem = fs.readFileSync("private_key.pem", "utf8");

  // THIS IS THE ONLY COMBINATION THAT WORKS WITH META RIGHT NOW
  const aesKey = crypto.privateDecrypt(
    {
      key: privateKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
      // These two lines are the magic fix:
      oaepLabel: Buffer.from("WhatsApp Encryption Payload", "utf8"),
      // Force MGF1-SHA256 (Meta's current requirement)
      oaepMGFFunction: (seed, length) => crypto.createHmac("sha256", seed).update("").digest().slice(0, length),
    },
    Buffer.from(encrypted_aes_key, "base64")
  );

  if (aesKey.length !== 32) {
    throw new Error(`Invalid AES key length: ${aesKey.length} bytes (expected 32)`);
  }

  const iv = Buffer.from(initial_vector, "base64");
  const encrypted = Buffer.from(encrypted_flow_data, "base64");
  const authTag = encrypted.slice(-16);
  const ciphertext = encrypted.slice(0, -16);

  const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString("utf8"));
}

  static async sendMessage(to, text) {
    const recipient = this.normalizePhone(to);
    const payload = {
      messaging_product: "whatsapp",
      to: recipient,
      type: "text",
      text: { body: text },
    };

    for (let i = 0; i < 3; i++) {
      try {
        await axios.post(
          `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
            timeout: 10000,
          }
        );
        logger.info(`[WhatsApp → ${recipient}] ${text}`);
        return;
      } catch (err) {
        if (i === 2)
          logger.error(
            "Failed to send message:",
            err.response?.data || err.message
          );
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  static async sendInteractive(to, interactive) {
    const recipient = this.normalizePhone(to);
    try {
      await axios.post(
        `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: recipient,
          type: "interactive",
          interactive,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          },
        }
      );
      logger.info(`[Interactive → ${recipient}] Sent`);
    } catch (err) {
      logger.error("Interactive failed:", err.response?.data);
      await this.sendMessage(to, "Please reply to continue.");
    }
  }

  // ONLY ONE JOB: Forward everything to AI
  static async handleIncomingMessage(
    rawFrom,
    message,
    messageId,
    profileName = "User"
  ) {
    const from = this.normalizePhone(rawFrom);
    const text = message.text?.body?.trim() || "";
    const isButton = message.interactive?.button_reply?.id;

    try {
      // Let AI handle EVERYTHING: onboarding, buttons, voice, registration, chat
      const reply = await langchainService.handleWhatsAppMessage({
        from,
        text,
        message,
        profileName,
        buttonId: isButton,
      });

      if (reply) {
        if (reply.type === "interactive") {
          await this.sendInteractive(from, reply.payload);
        } else {
          await this.sendMessage(from, reply.text);
        }
      }
    } catch (err) {
      logger.error("AI handler failed:", err);
      await this.sendMessage(from, "Sorry, I'm having issues. Try again soon.");
    }
  }

  static verifyWebhook(query) {
    if (
      query["hub.mode"] === "subscribe" &&
      query["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN
    ) {
      return query["hub.challenge"];
    }
    throw new Error("Forbidden");
  }
}

export default WhatsAppService;

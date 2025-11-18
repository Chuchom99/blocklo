// import { ChatOpenAI } from '@langchain/openai';
// import { HumanMessage } from '@langchain/core/messages';
// import logger from '../config/logger.js';
// import redis from '../config/redis.js';
// import { v4 as uuidv4 } from 'uuid';
// import { handleTransfer, handleBalance, handleKycStatus, handleTransactionHistory } from './ai.handler.js';
// import WhatsAppService from './whatsapp.services.js';

// class LangChainService {
//   constructor() {
//     this.llm = new ChatOpenAI({
//       apiKey: process.env.LLM_API_KEY,
//       model: process.env.LLM_MODEL || 'deepseek-chat',
//       temperature: 0.7,
//       configuration: {
//         baseURL: process.env.LLM_BASE_URL || 'https://api.deepseek.com',
//       },
//     });
//   }

//   /**
//    * Core entry point for WhatsApp or web messages
//    */
//   async processMessage(from, message, userId) {
//     try {
//       const cacheKey = `ai:${from}:${message}`;
//       const cached = await redis.get(cacheKey);
//       if (cached) {
//         logger.info(`AI cache hit for ${from}`);
//         return JSON.parse(cached);
//       }

//       let response;

//       // === Command Routing ===
//       const lowerMsg = message.toLowerCase();

//       if (lowerMsg.includes('register') || lowerMsg.includes('signin')) {
//         response = await this._handleRegistrationFlow(from);
//       } else if (lowerMsg.startsWith('transfer')) {
//         response = await handleTransfer(from, message, userId);
//       } else if (lowerMsg.includes('balance')) {
//         response = await handleBalance(userId);
//       } else if (lowerMsg.startsWith('kyc ')) {
//         response = await handleKyc(from, message, userId);
//       } else if (lowerMsg.includes('kyc status')) {
//         response = await handleKycStatus(userId);
//       } else if (lowerMsg.includes('history')) {
//         response = await handleTransactionHistory(userId);
//       } else {
//         // === Fallback: LLM conversation ===
//         const llmResponse = await this.llm.invoke([
//           new HumanMessage(
//             `You are a smart fintech assistant for WhatsApp banking.
//             User (${from}) says: "${message}".
//             Respond clearly and helpfully in less than 3 sentences.`
//           ),
//         ]);
//         response = llmResponse.content;
//       }

//       // Cache for 1 hour
//       await redis.setEx(cacheKey, 3600, JSON.stringify(response));
//       return response;

//     } catch (error) {
//       logger.error(`AI Error (${from}): ${error.message}`);
//       return 'Sorry, something went wrong. Please try again.';
//     }
//   }

//   async _handleRegistrationFlow(from) {
//     const flowId = process.env.WHATSAPP_REGISTRATION_FLOW_ID;
//     if (!flowId) {
//       logger.error('Missing WHATSAPP_REGISTRATION_FLOW_ID');
//       return 'Registration is currently unavailable. Try again later.';
//     }
//     const flowToken = uuidv4();
//     await WhatsAppService.sendRegistrationFlow(from, flowId, flowToken);
//     return 'Please complete the form sent to your WhatsApp to register or sign in.';
//   }
// }

// export const langchainService = new LangChainService();
// export default LangChainService;

// import { ChatOpenAI } from "@langchain/openai";
// import { HumanMessage, SystemMessage } from "@langchain/core/messages";
// import logger from "../config/logger.js";
// import redis from "../config/redis.js";
// import { v4 as uuidv4 } from "uuid";
// import {
//   handleTransfer,
//   handleBalance,
//   handleKycStatus,
//   handleTransactionHistory,
// } from "./ai.handler.js";
// import WhatsAppService from "./whatsapp.services.js";

// class LangChainService {
//   constructor() {
//     this.llm = new ChatOpenAI({
//       apiKey: process.env.LLM_API_KEY,
//       model: process.env.LLM_MODEL || "gpt-4o-mini",
//       temperature: 0.4, // balanced intelligence and determinism
//       configuration: {
//         baseURL: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
//       },
//     });
//   }

//   async processMessage(from, message, userId) {
//     try {
//       const cacheKey = `ai:${from}:${message}`;
//       // const cached = await redis.get(cacheKey);
//       // if (cached) {
//       //   logger.info(`AI cache hit for ${from}`);
//       //   return JSON.parse(cached);
//       // }

//       // === Step 1. Intent detection ===
//       const intentPrompt = [
//         new SystemMessage(`
// You are a financial assistant for a WhatsApp banking app called Blocklo.
// Identify the user's intent from their message.

// Your possible intents are:
// ["transfer", "balance", "kyc", "kyc_status", "history", "register", "smalltalk", "unknown"]

// You must infer meaning, not just keywords.
// Examples:
// - "send 500 to 0123456789" → transfer
// - "transfer ₦1000 to John at Access Bank" → transfer
// - "check my balance", "how much do I have", "funds left", "wallet amount" → balance
// - "show transaction history", "my recent transactions" → history
// - "what's my kyc status", "is my account verified" → kyc_status
// - "my bvn is 12345678901", "verify my identity", "complete kyc" → kyc
// - "register me", "sign up", "create an account" → register
// - "hi", "hello", "how are you", "thank you" → smalltalk

// Extract any entities like amount, account number, BVN, or bank name if mentioned.

// Respond ONLY in valid JSON.
// Example:
// {"intent": "transfer", "amount": "500", "account": "0123456789", "bvn": "", "bank": "Access Bank"}
// If unsure, respond:
// {"intent": "unknown"}
//         `),
//         new HumanMessage(message),
//       ];

//       const intentResponse = await this.llm.invoke(intentPrompt);
//       logger.debug(`[AI RAW INTENT RESPONSE] ${intentResponse.content}`);

//       const parsed = this._safeJSON(intentResponse.content);
//       logger.info(`[AI] Parsed intent for ${from}: ${JSON.stringify(parsed)}`);

//       let response;

//       // === Step 2. Route based on detected intent ===
//       switch (parsed.intent) {
//         case "transfer":
//           response = await handleTransfer(
//             from,
//             `transfer ${parsed.amount || ""} to ${parsed.account || ""} ${
//               parsed.bank || ""
//             }`,
//             userId
//           );
//           break;

//         case "balance":
//           response = await handleBalance(userId);
//           break;

//         case "kyc":
//           response = await handleKyc(from, message, userId);
//           break;

//         case "kyc_status":
//           response = await handleKycStatus(userId);
//           break;

//         case "history":
//           response = await handleTransactionHistory(userId);
//           break;

//         case "register":
//           response = await this._handleRegistrationFlow(from);
//           break;

//         case "smalltalk":
//           response = await this._smallTalk(message);
//           break;

//         default:
//           // fallback – general AI response
//           const fallbackResponse = await this.llm.invoke([
//             new SystemMessage(`
// You are Blocklo's friendly WhatsApp banking assistant.
// If user asks about Blocklo, explain what Blocklo does in under 3 sentences.
// If unsure, politely guide them to type 'help' for available options.
//             `),
//             new HumanMessage(message),
//           ]);
//           response = fallbackResponse.content;
//           break;
//       }

//       // === Step 3. Cache & return ===
//       // await redis.setEx(cacheKey, 3600, JSON.stringify(response));
//       return response;
//     } catch (error) {
//       logger.error(`[LangChain AI Error for ${from}]: ${error.message}`);
//       logger.debug(`[LangChain AI Stack]: ${error.stack}`);
//       return `⚠️ Oops, I couldn't process that right now. Try again shortly.`;
//     }
//   }

//   async _handleRegistrationFlow(from) {
//     const flowId = process.env.WHATSAPP_REGISTRATION_FLOW_ID;
//     if (!flowId) {
//       logger.error("Missing WHATSAPP_REGISTRATION_FLOW_ID");
//       return "Registration is currently unavailable. Try again later.";
//     }
//     const flowToken = uuidv4();
//     await WhatsAppService.sendRegistrationFlow(from, flowId, flowToken);
//     return "📋 Please complete the form sent to your WhatsApp to register or sign in.";
//   }

//   async _smallTalk(message) {
//     const chatResponse = await this.llm.invoke([
//       new SystemMessage(
//         `You are a friendly AI assistant. Reply warmly in under 2 sentences.`
//       ),
//       new HumanMessage(message),
//     ]);
//     return chatResponse.content;
//   }

//   _safeJSON(str) {
//     try {
//       const jsonMatch = str.match(/\{[\s\S]*\}/);
//       if (!jsonMatch) return { intent: "unknown" };
//       return JSON.parse(jsonMatch[0]);
//     } catch (err) {
//       logger.warn(`[AI] Failed to parse intent JSON: ${str}`);
//       return { intent: "unknown" };
//     }
//   }
// }

// export const langchainService = new LangChainService();
// export default LangChainService;

// open ai bot
// import { openai } from "./openai-client.js";
// import { psbFunctions } from "../tools/psb-tools.js";
// import logger from "../config/logger.js";
// import redis from "../config/redis.js";

// class LangChainService {
//   constructor() {
//     this.functions = psbFunctions.map(f => ({
//       type: "function",
//       function: {
//         name: f.name,
//         description: f.description,
//         parameters: f.parameters,
//       },
//     }));
//   }

//   async processMessage(from, message, userId) {
//     const cacheKey = `ai:${from}:${Buffer.from(message).toString("base64").slice(0, 50)}`;
//     const cached = await redis.get(cacheKey);
//     if (cached) {
//       logger.info(`[AI] Cache hit for ${from}`);
//       return JSON.parse(cached);
//     }

//     try {
//       const context = { from, userId };

//       const response = await openai.chat.completions.create({
//         model: "gpt-4o-mini",
//         temperature: 0.3,
//         messages: [
//           {
//             role: "system",
//             content: `You are Blocklo, a WhatsApp banking assistant for 9PSB wallets.
//             - Be concise, friendly, and professional.
//             - Never expose full account numbers.
//             - Confirm every transfer.
//             - Use tools when needed.`,
//           },
//           { role: "user", content: message },
//         ],
//         tools: this.functions,
//         tool_choice: "auto",
//       });

//       const msg = response.choices[0].message;

//       // === TOOL CALLS ===
//       if (msg.tool_calls) {
//         const toolResponses = [];

//         for (const call of msg.tool_calls) {
//           const func = psbFunctions.find(f => f.name === call.function.name);
//           if (!func) continue;

//           const args = JSON.parse(call.function.arguments);
//           const result = await func.handler(args, context);
//           toolResponses.push({
//             role: "tool",
//             tool_call_id: call.id,
//             content: result,
//           });
//         }

//         // Second pass: synthesize final reply
//         const final = await openai.chat.completions.create({
//           model: "gpt-4o",
//           messages: [
//             { role: "system", content: "Summarize the tool results naturally." },
//             { role: "user", content: message },
//             msg,
//             ...toolResponses,
//           ],
//         });

//         const reply = final.choices[0].message.content;
//         await redis.setEx(cacheKey, 3600, JSON.stringify(reply));
//         return reply;
//       }

//       // === NO TOOL: small talk or help ===
//       const reply = msg.content;
//       await redis.setEx(cacheKey, 3600, JSON.stringify(reply));
//       return reply;
//     } catch (error) {
//       logger.error(`[AI] ${error.message}`, { stack: error.stack });
//       return "I’m having trouble right now. Please try again in a minute.";
//     }
//   }
// }

// export const langchainService = new LangChainService();
// export default LangChainService;



//without user context
// import { ChatDeepSeek } from "@langchain/deepseek";
// import logger from "../config/logger.js";
// import redis from "../config/redis.js";
// import { psbFunctions } from "../tools/psb-tools.js";
// import { psbVasFunctions } from "../tools/psb-vas-tools.js";
// import { VasIntentService } from "./vas-intent-services.js";
// import { BillsIntentService } from "./bills.intent.services.js";
// import { TransferIntentService } from "./handleTransferToBeneficiary.js"
// // import { BeneficiaryService } from "./beneficiary.service.js";

// class LangChainService {
//   constructor() {
//     this.llm = new ChatDeepSeek({
//       apiKey: process.env.DEEPSEEK_API_KEY,
//       model: "deepseek-chat",
//       temperature: 0.3,
//     });

//     const allFunctions = [...psbFunctions, ...psbVasFunctions];
//     this.tools = allFunctions.map((tool) => ({
//       type: "function",
//       function: {
//         name: tool.name,
//         description: tool.description,
//         parameters: tool.parameters,
//       },
//     }));
//   }

//   // async processMessage(from, message, userId) {
//   //   const cacheKey = `ai:${from}:${Buffer.from(message).toString("base64").slice(0, 50)}`;
//   //   const cached = await redis.get(cacheKey);
//   //   if (cached) return JSON.parse(cached);

//   //   // === 1. TRY VAS FIRST (FAST PATH) ===
//   //   const vasReply = await VasIntentService.process(userId, message);
//   //   if (vasReply) {
//   //     await redis.setEx(cacheKey, 3600, JSON.stringify(vasReply));
//   //     return vasReply;
//   //   }

//   //   // === 2. FALLBACK TO DEEPSEEK (LLM) ===
//   //   const messages = [
//   //     {
//   //       role: "system",
//   //       content: `You are Blocklo.
//   // - Use tools for balance, transfer, history, KYC.
//   // - NEVER handle airtime, data, or bills.
//   // - Reply naturally.`,
//   //     },
//   //     { role: "user", content: message },
//   //   ];

//   //   const response = await this.llm.invoke(messages, {
//   //     tools: this.tools,
//   //     tool_choice: "auto",
//   //   });

//   //   let aiReply = "";

//   //   if (response.tool_calls?.length > 0) {
//   //     const toolMessages = [];
//   //     for (const toolCall of response.tool_calls) {
//   //       const result = await this.executeTool(toolCall, { from, userId });
//   //       toolMessages.push({
//   //         role: "tool",
//   //         tool_call_id: toolCall.id,
//   //         name: toolCall.name,
//   //         content: typeof result === "string" ? result : JSON.stringify(result),
//   //       });
//   //     }
//   //     const finalResponse = await this.llm.invoke([...messages, response, ...toolMessages]);
//   //     aiReply = finalResponse.content || "Done!";
//   //   } else {
//   //     aiReply = response.content || "I'm here to help!";
//   //   }

//   //   await redis.setEx(cacheKey, 3600, JSON.stringify(aiReply));
//   //   return aiReply;
//   // }

//   // === GET CONVERSATION HISTORY ===
//   async getHistory(from) {
//     try {
//       const key = `convo:${from}`;
//       const raw = await redis.get(key);
//       if (!raw) return [];

//       const history = JSON.parse(raw);
//       // Keep only last 10 messages (5 turns)
//       return history.slice(-10);
//     } catch (err) {
//       logger.warn(`[History] Load failed for ${from}: ${err.message}`);
//       return [];
//     }
//   }

//   // === SAVE MESSAGE TO HISTORY ===
//   async saveMessage(from, role, content) {
//     try {
//       const key = `convo:${from}`;
//       const history = await this.getHistory(from);

//       history.push({ role, content });
//       // Keep only last 10
//       if (history.length > 10) history.shift();

//       await redis.setEx(key, 86400, JSON.stringify(history)); // 24h expiry
//     } catch (err) {
//       logger.warn(`[History] Save failed: ${err.message}`);
//     }
//   }

//   const userContext = u

//   async processMessage(from, message, userId) {
//     const cacheKey = `ai:${from}:${Buffer.from(message)
//       .toString("base64")
//       .slice(0, 50)}`;
//     const cached = await redis.get(cacheKey);
//     if (cached) return JSON.parse(cached);

//     const context = { from, userId };

//     // === 1. TRY VAS (NO HISTORY NEEDED) ===
//     const vasReply = await VasIntentService.process(userId, message);
//     if (vasReply) {
//       await this.saveMessage(from, "user", message);
//       await this.saveMessage(from, "assistant", vasReply);
//       await redis.setEx(cacheKey, 3600, JSON.stringify(vasReply));
//       return vasReply;
//     }

//     const billReply = await BillsIntentService.process(userId, message, from);
//     if (billReply) {
//       await this.saveMessage(from, "user", message);
//       await this.saveMessage(from, "assistant", billReply);
//       await redis.setEx(cacheKey, 3600, JSON.stringify(billReply));
//       return billReply;
//     }

//     const transferReply = await TransferIntentService.process(
//       userId,
//       message,
//       from
//     );
//     if (transferReply) {
//       await this.saveMessage(from, "user", message);
//       await this.saveMessage(from, "assistant", transferReply);
//       await redis.setEx(cacheKey, 3600, JSON.stringify(transferReply));
//       return transferReply;
//     }

//     // === 2. LOAD HISTORY ===
//     const history = await this.getHistory(from);

//     // === 3. BUILD MESSAGES WITH HISTORY ===
//     const messages = [
//       {
//         role: "system",
//         content: `You are Blocklo, a helpful WhatsApp banking assistant.
// - You remember the last 5 conversation turns.
// - Use tools for balance, transfer, history, KYC.
// - Reply naturally.`,
//       },
//       ...history,
//       { role: "user", content: message },
//     ];

//     // === 4. CALL DEEPSEEK ===
//     const response = await this.llm.invoke(messages, {
//       tools: this.tools,
//       tool_choice: "auto",
//     });

//     let aiReply = "";

//     if (response.tool_calls?.length > 0) {
//       const toolMessages = [];
//       for (const toolCall of response.tool_calls) {
//         const result = await this.executeTool(toolCall, context);
//         toolMessages.push({
//           role: "tool",
//           tool_call_id: toolCall.id,
//           name: toolCall.name,
//           content: typeof result === "string" ? result : JSON.stringify(result),
//         });
//       }
//       const finalMessages = [...messages, response, ...toolMessages];
//       const finalResponse = await this.llm.invoke(finalMessages);
//       aiReply = finalResponse.content || "Done!";
//     } else {
//       aiReply = response.content || "I'm here to help!";
//     }

//     // === 5. SAVE TO HISTORY ===
//     await this.saveMessage(from, "user", message);
//     await this.saveMessage(from, "assistant", aiReply);

//     await redis.setEx(cacheKey, 3600, JSON.stringify(aiReply));
//     return aiReply;
//   }

//   // === executeTool (unchanged) ===
//   async executeTool(toolCall, context) {
//     const { name, arguments: args } = toolCall;
//     const tool = [...psbFunctions, ...psbVasFunctions].find(
//       (t) => t.name === name
//     );
//     if (!tool) return "Unknown command.";
//     return await tool
//       .handler(args, context)
//       .catch((err) => `Error: ${err.message}`);
//   }
// }

// export const langchainService = new LangChainService();

// src/services/langchain.service.js
// import { ChatDeepSeek } from "@langchain/deepseek";
// import logger from "../config/logger.js";
// import redis from "../config/redis.js";
// import { psbFunctions } from "../tools/psb-tools.js";
// import { psbVasFunctions } from "../tools/psb-vas-tools.js";
// import { VasIntentService } from "./vas-intent-services.js";
// import { BillsIntentService } from "./bills.intent.services.js";
// import { TransferIntentService } from "./handleTransferToBeneficiary.js";
// import UserService from "./user.service.js";

// class LangChainService {
//   constructor() {
//     this.llm = new ChatDeepSeek({
//       apiKey: process.env.DEEPSEEK_API_KEY,
//       model: "deepseek-chat",
//       temperature: 0.3,
//     });

//     const allFunctions = [...psbFunctions, ...psbVasFunctions];
//     this.tools = allFunctions.map((tool) => ({
//       type: "function",
//       function: {
//         name: tool.name,
//         description: tool.description,
//         parameters: tool.parameters,
//       },
//     }));
//   }

//   // GET RICH USER CONTEXT
//   // async getUserContext(from) {
//   //   try {
//   //     // Normalize: remove + if any
//   //     const cleanFrom = from.replace(/^\+/, "");

//   //     // Try exact match first
//   //     let user = await prisma.user.findUnique({
//   //       where: { whatsappId: cleanFrom },
//   //       include: {
//   //         accounts: true,
//   //         transactions: { orderBy: { createdAt: "desc" }, take: 5 },
//   //       },
//   //     });

//   //     // If not found → try with 0 prefix (common in Nigeria)
//   //     if (!user && cleanFrom.startsWith("234")) {
//   //       const localFormat = "0" + cleanFrom.slice(3);
//   //       user = await prisma.user.findFirst({
//   //         where: { OR: [
//   //           { whatsappId: cleanFrom },
//   //           { whatsappId: localFormat },
//   //           { phone: localFormat },
//   //         ]},
//   //         include: {
//   //           accounts: true,
//   //           transactions: { orderBy: { createdAt: "desc" }, take: 5 },
//   //         },
//   //       });
//   //     }

//   //     if (!user || !user.accounts?.[0]) return null;

//   //     const account = user.accounts[0];

//   //     return {
//   //       isRegistered: true,
//   //       name: `${user.firstName} ${user.lastName}`.trim(),
//   //       firstName: user.firstName,
//   //       accountNumber: account.accountNumber,
//   //       balance: Number(account.balance).toLocaleString("en-NG"),
//   //       recentTransactions: user.transactions.map(t => ({
//   //         date: new Date(t.createdAt).toLocaleDateString("en-NG"),
//   //         amount: t.amount.toLocaleString("en-NG"),
//   //         type: t.type,
//   //         description: t.description || "Transaction",
//   //       })),
//   //     };
//   //   } catch (err) {
//   //     logger.error("getUserContext failed:", err.message);
//   //     return null;
//   //   }
//   // }

//   async getUserContext(from) {
//     try {
//       // Normalize incoming number: remove + and any spaces
//       const cleanFrom = from.replace(/^\+234/, "234").replace(/[^0-9]/g, "");

//       // Search by whatsappId AND phone field — double safety
//       const user = await prisma.user.findFirst({
//         where: {
//           OR: [
//             { whatsappId: cleanFrom },
//             { whatsappId: `+${cleanFrom}` },
//             { whatsappId: cleanFrom.replace(/^234/, "0") },
//             { phone: cleanFrom },
//             { phone: cleanFrom.replace(/^234/, "0") },
//             { phone: `+${cleanFrom}` },
//           ],
//         },
//         include: {
//           accounts: {
//             include: {
//               transactions: { orderBy: { createdAt: "desc" }, take: 5 },
//             },
//           },
//         },
//       });

//       if (!user || !user.accounts?.[0]) {
//         logger.info(
//           `[AI] No user found for ${from} → normalized: ${cleanFrom}`
//         );
//         return null;
//       }

//       const account = user.accounts[0];

//       logger.info(
//         `[AI] User found: ${user.firstName} ${user.lastName} → ${account.accountNumber}`
//       );

//       return {
//         isRegistered: true,
//         name: `${user.firstName} ${user.lastName}`.trim(),
//         firstName: user.firstName,
//         accountNumber: account.accountNumber,
//         balance: Number(account.balance).toLocaleString("en-NG"),
//         currency: account.currency || "NGN",
//         recentTransactions: account.transactions.map((t) => ({
//           date: new Date(t.createdAt).toLocaleDateString("en-NG"),
//           amount: t.amount.toLocaleString("en-NG"),
//           type: t.type,
//           description: t.description || "Transaction",
//         })),
//       };
//     } catch (err) {
//       logger.error("getUserContext error:", err.message);
//       return null;
//     }
//   }
//   // GET CONVERSATION HISTORY
//   async getHistory(from) {
//     try {
//       const raw = await redis.get(`convo:${from}`);
//       return raw ? JSON.parse(raw).slice(-10) : [];
//     } catch {
//       return [];
//     }
//   }

//   // SAVE TO HISTORY
//   async saveMessage(from, role, content) {
//     try {
//       const key = `convo:${from}`;
//       const history = await this.getHistory(from);
//       history.push({ role, content });
//       if (history.length > 10) history.shift();
//       await redis.setEx(key, 86400, JSON.stringify(history));
//     } catch (err) {
//       logger.warn("History save failed:", err.message);
//     }
//   }

//   async processMessage(from, message, userId) {
//     const cacheKey = `ai:${from}:${Buffer.from(message)
//       .toString("base64")
//       .slice(0, 50)}`;
//     const cached = await redis.get(cacheKey);
//     if (cached) return JSON.parse(cached);

//     const context = { from, userId };

//     // FAST PATH: VAS / BILLS / TRANSFER
//     const vasReply = await VasIntentService.process(userId, message);
//     if (vasReply) {
//       await this.saveMessage(from, "user", message);
//       await this.saveMessage(from, "assistant", vasReply);
//       await redis.setEx(cacheKey, 3600, JSON.stringify(vasReply));
//       return vasReply;
//     }

//     const billReply = await BillsIntentService.process(userId, message, from);
//     if (billReply) {
//       await this.saveMessage(from, "user", message);
//       await this.saveMessage(from, "assistant", billReply);
//       await redis.setEx(cacheKey, 3600, JSON.stringify(billReply));
//       return billReply;
//     }

//     const transferReply = await TransferIntentService.process(
//       userId,
//       message,
//       from
//     );
//     if (transferReply) {
//       await this.saveMessage(from, "user", message);
//       await this.saveMessage(from, "assistant", transferReply);
//       await redis.setEx(cacheKey, 3600, JSON.stringify(transferReply));
//       return transferReply;
//     }

//     // LOAD USER CONTEXT + HISTORY
//     const userContext = await this.getUserContext(from);
//     const history = await this.getHistory(from);

//     // BUILD SMART SYSTEM PROMPT
//     const systemPrompt = userContext
//       ? `You are Blocklo Assistant — a smart Nigerian banking AI.

// USER CONTEXT:
// • Name: ${userContext.name}
// • Account: ${userContext.accountNumber}
// • Balance: ₦${userContext.balance}
// • Recent: ${
//           userContext.recentTransactions
//             .map(
//               (t) => `${t.date}: ${t.type === "credit" ? "+" : "-"}₦${t.amount}`
//             )
//             .join(" | ") || "None"
//         }

// Be warm, professional, and speak like a real bank.
// Greet by name. Confirm transfers. Never share full BVN/NIN.`
//       : `You are Blocklo Assistant. Help users create accounts or answer questions.`;

//     const messages = [
//       { role: "system", content: systemPrompt },
//       ...history,
//       { role: "user", content: message },
//     ];

//     // CALL DEEPSEEK WITH TOOLS
//     const response = await this.llm.invoke(messages, {
//       tools: this.tools,
//       tool_choice: "auto",
//     });

//     let aiReply = "";

//     if (response.tool_calls?.length > 0) {
//       const toolMessages = [];
//       for (const toolCall of response.tool_calls) {
//         const result = await this.executeTool(toolCall, context);
//         toolMessages.push({
//           role: "tool",
//           tool_call_id: toolCall.id,
//           name: toolCall.name,
//           content: typeof result === "string" ? result : JSON.stringify(result),
//         });
//       }
//       const finalResponse = await this.llm.invoke([
//         ...messages,
//         response,
//         ...toolMessages,
//       ]);
//       aiReply = finalResponse.content || "Done!";
//     } else {
//       aiReply = response.content || "I'm here to help!";
//     }

//     // SAVE & CACHE
//     await this.saveMessage(from, "user", message);
//     await this.saveMessage(from, "assistant", aiReply);
//     await redis.setEx(cacheKey, 3600, JSON.stringify(aiReply));

//     return aiReply;
//   }

//   async executeTool(toolCall, context) {
//     const { name, arguments: args } = toolCall;
//     const tool = [...psbFunctions, ...psbVasFunctions].find(
//       (t) => t.name === name
//     );
//     if (!tool) return "Unknown command.";
//     try {
//       return await tool.handler(args, context);
//     } catch (err) {
//       return `Error: ${err.message}`;
//     }
//   }
// }

// export const langchainService = new LangChainService();

// src/services/ai.services.js → rename to ai.services.js

import { ChatDeepSeek } from "@langchain/deepseek";
import logger from "../config/logger.js";
import redis from "../config/redis.js";
import prisma from "../config/prisma.js";
import UserService from "./user.service.js";
import crypto from "crypto";
import { psbFunctions, psbVasFunctions } from "../tools/index.js";
import {
  VasIntentService,
  BillsIntentService,
  TransferIntentService,
} from "../intent/index.js";

class LangChainService {
  constructor() {
    this.llm = new ChatDeepSeek({
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: "deepseek-chat",
      temperature: 0.3,
    });
    this.tools = [...psbFunctions, ...psbVasFunctions].map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  // BULLETPROOF USER LOOKUP
  async getUserContext(from) {
    const normalized = from.replace(/[^\d]/g, "").replace(/^234/, "234");
    if (normalized.length < 10) return null;

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { whatsappId: { contains: normalized.slice(-10) } },
          { phone: { contains: normalized.slice(-10) } },
          { whatsappId: normalized },
          { phone: normalized },
        ],
      },
      include: {
        accounts: {
          include: {
            transactions: {
              take: 5,
              orderBy: { createdAt: "desc" },
            },
          },
        },
      },
    });

    if (!user || !user.accounts?.[0] || !user.firstName) {
      logger.info(`[AI] Incomplete user data for ${from}`);
      return null; // Force unregistered flow
    }

    const acc = user.accounts[0];
    return {
      isRegistered: true,
      name: `${user.firstName} ${user.lastName}`.trim(),
      firstName: user.firstName,
      accountNumber: acc.accountNumber,
      balance: Number(acc.balance).toLocaleString("en-NG"),
      kycLevel: user.kycLevel || 1,
      recentTransactions: acc.transactions.map((t) => ({
        date: new Date(t.createdAt).toLocaleDateString("en-NG"),
        amount: t.amount.toLocaleString("en-NG"),
        type: t.type,
        description: t.description || "Transaction",
      })),
    };
  }

  async getHistory(from) {
    try {
      const raw = await redis.get(`convo:${from}`);
      return raw ? JSON.parse(raw).slice(-10) : [];
    } catch {
      return [];
    }
  }

  async saveMessage(from, role, content) {
    try {
      const key = `convo:${from}`;
      const history = await this.getHistory(from);
      history.push({ role, content });
      if (history.length > 10) history.shift();
      await redis.setEx(key, 86400, JSON.stringify(history));
    } catch (err) {
      logger.warn("History save failed:", err.message);
    }
  }

  // MAIN BRAIN — HANDLES EVERYTHING
  async handleWhatsAppMessage({
    from,
    text = "",
    message,
    profileName = "User",
    buttonId,
  }) {
    const userContext = await this.getUserContext(from);
    const onboardingKey = `onboarding:${from}`;

    // ONBOARDING ACTIVE
    if (await redis.get(onboardingKey)) {
      return await this.handleOnboardingFlow(from, message, buttonId);
    }

    // BUTTON: Start signup
    if (buttonId === "START_SIGNUP") {
      return this.startOnboarding(from, profileName);
    }

    // USER NOT REGISTERED
    if (!userContext) {
      const welcomeText = `Hi ${
        profileName.split(" ")[0]
      }! Welcome to *Blocklo × 9PSB*\n\nYou haven't created your wallet yet.\n\nReply with *create account* to open your bank account in 60 seconds — right here on WhatsApp!`;
      return { text: welcomeText };
    }

    // REGISTERED USER → FULL AI CHAT
    // return await this.processAIChat(from, text || "hi", userContext);
    const userId = userContext.userId || from; // fallback
    return await this.processAIChat(from, text || "hi", userContext, userId);
  }

  // FULL ONBOARDING FLOW — NOW 100% IN AI
  async handleOnboardingFlow(from, message, buttonId) {
    const raw = await redis.get(`onboarding:${from}`);
    let state = raw ? JSON.parse(raw) : { step: "gender", data: {} };
    let { step, data } = state;

    if (buttonId?.startsWith("GENDER_")) {
      data.gender = buttonId === "GENDER_MALE" ? 0 : 1;
      await redis.setEx(
        `onboarding:${from}`,
        3600,
        JSON.stringify({ step: "name", data })
      );
      return { text: "What's your full name?\n(e.g. Chukwudi Okonkwo)" };
    }

    if (step === "name" && message.text?.body) {
      const name = message.text.body.trim();
      if (name.split(" ").length < 2)
        return { text: "Please send your full name (first + last)." };
      const [firstName, ...rest] = name.split(" ");
      data.firstName = firstName;
      data.lastName = rest.join(" ") || "User";
      await redis.setEx(
        `onboarding:${from}`,
        3600,
        JSON.stringify({ step: "email", data })
      );
      return { text: `Thanks, ${firstName}!\n\nNow send your email address:` };
    }

    if (step === "email" && message.text?.body) {
      const email = message.text.body.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return { text: "Invalid email. Try again:" };
      data.email = email;
      await redis.setEx(
        `onboarding:${from}`,
        3600,
        JSON.stringify({ step: "dob", data })
      );
      return { text: "Date of birth? (dd/mm/yyyy)\ne.g. 15/08/1995" };
    }

    if (step === "dob" && message.text?.body) {
      const dob = message.text.body.trim();
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dob))
        return { text: "Use format: dd/mm/yyyy" };
      data.dateOfBirth = dob;
      await redis.setEx(
        `onboarding:${from}`,
        3600,
        JSON.stringify({ step: "address", data })
      );
      return {
        text: "Your residential address?\n(e.g. 12 Adeola Odeku, Victoria Island, Lagos)",
      };
    }

    if (step === "address" && message.text?.body) {
      data.address = message.text.body.trim();
      await redis.setEx(
        `onboarding:${from}`,
        3600,
        JSON.stringify({ step: "nin", data })
      );
      return { text: "Your 11-digit NIN:" };
    }

    if (step === "nin" && message.text?.body) {
      const nin = message.text.body.trim();
      if (!/^\d{11}$/.test(nin)) return { text: "NIN must be 11 digits." };
      data.nin = nin;
      await redis.setEx(
        `onboarding:${from}`,
        3600,
        JSON.stringify({ step: "bvn", data })
      );
      return { text: "Your 11-digit BVN:" };
    }

    if (step === "bvn" && message.text?.body) {
      const bvn = message.text.body.trim();
      if (!/^\d{11}$/.test(bvn)) return { text: "BVN must be 11 digits." };
      data.bvn = bvn;
      await redis.setEx(
        `onboarding:${from}`,
        3600,
        JSON.stringify({ step: "pin", data })
      );
      return { text: "Almost done!\n\nSet your 4-digit PIN:\n(e.g. 1234)" };
    }

    if (step === "pin" && /^\d{4}$/.test(message.text?.body)) {
      await redis.del(`onboarding:${from}`);

      const finalData = {
        ...data,
        pin: message.text.body.trim(),
        whatsappId: from,
        phone: from.replace("234", "0"),
        password: crypto.randomBytes(20).toString("hex"),
        termsAgreed: true,
        kycLevel: 1,
      };

      try {
        const result = await UserService.createUser(finalData);
        const accountNumber = result.accountNumber || "11000XXXXX";

        return {
          text: `Account created successfully, ${data.firstName}!

Your 9PSB Wallet is LIVE

Account Number: ${accountNumber}
Bank: 9 Payment Service Bank (9PSB)

Say *balance* to check your money

Welcome to Blocklo × 9PSB`,
        };
      } catch (err) {
        return { text: "Registration failed. Say *start over* to try again." };
      }
    }

    return { text: "Please complete the current step." };
  }

  startOnboarding(from, name) {
    redis.setEx(
      `onboarding:${from}`,
      3600,
      JSON.stringify({ step: "gender", data: { profileName: name } })
    );
    return {
      type: "interactive",
      payload: {
        type: "button",
        body: {
          text: "Let's create your Blocklo account\n\nFirst, select your gender:",
        },
        action: {
          buttons: [
            { type: "reply", reply: { id: "GENDER_MALE", title: "Male" } },
            { type: "reply", reply: { id: "GENDER_FEMALE", title: "Female" } },
          ],
        },
      },
    };
  }

  async processAIChat(from, message, userContext, userId) {
    // SAFETY FIRST — NEVER CRASH
    if (!userContext || !userContext.name) {
      return "Hi! I recognize you but couldn't load your details. Say *balance* to refresh.";
    }
    const cacheKey = `ai:${from}:${Buffer.from(message)
      .toString("base64")
      .slice(0, 50)}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const history = await this.getHistory(from);

    // FAST PATH: VAS / BILLS / TRANSFER
    // const vasReply = await VasIntentService.process(userId, message);
    // if (vasReply) {
    //   await this.saveMessage(from, "user", message);
    //   await this.saveMessage(from, "assistant", vasReply);
    //   await redis.setEx(cacheKey, 3600, JSON.stringify(vasReply));
    //   return {text: vasReply};
    // }
    // === SMART AIRTIME & DATA FLOW — NIGERIA'S SMARTEST AI EVER ===
    const vasContext = await redis.get(`vas:${from}`);
    if (vasContext) {
      try {
        const ctx = JSON.parse(vasContext);

        // SUPPORT BOTH AIRTIME AND DATA
        if (
          ctx.flow === "airtime" &&
          ctx.network &&
          ctx.network !== "UNKNOWN"
        ) {
          const networkEmoji =
            { MTN: "MTN", GLO: "GLO", AIRTEL: "AIRTEL", "9MOBILE": "9MOBILE" }[
              ctx.network
            ] || "";
          const reply = `${networkEmoji} Perfect! How much *${ctx.network}* **airtime** do you want?\n\n(₦100 - ₦50,000)`;

          await this.saveMessage(from, "assistant", reply);
          await redis.setEx(cacheKey, 3600, JSON.stringify(reply));
          return { text: reply };
        }

        if (ctx.flow === "data" && ctx.network && ctx.network !== "UNKNOWN") {
          const networkEmoji =
            { MTN: "MTN", GLO: "GLO", AIRTEL: "AIRTEL", "9MOBILE": "9MOBILE" }[
              ctx.network
            ] || "";
          const reply = `${networkEmoji} Great! How much *${ctx.network}* **data** do you want to buy?\n\nReply with amount (e.g. *₦500*) or say *plans* to see bundles`;

          await this.saveMessage(from, "assistant", reply);
          // When user says "buy airtime"
await redis.setEx(`vas:${from}`, 1800, JSON.stringify({
  flow: "airtime",
  step: "awaiting_phone"
}));
return "Which number do you want to recharge?";

// When user says "buy data"
await redis.setEx(`vas:${from}`, 1800, JSON.stringify({
  flow: "data",
  step: "awaiting_phone"
}));
return "Which number do you want data for?";
          return { text: reply };
        }
      } catch (err) {
        logger.warn("Failed to parse vas context:", err);
      }
    }

    const billReply = await BillsIntentService.process(userId, message, from);
    if (billReply) {
      await this.saveMessage(from, "user", message);
      await this.saveMessage(from, "assistant", billReply);
      await redis.setEx(cacheKey, 3600, JSON.stringify(billReply));
      return { text: billReply };
    }

    const transferReply = await TransferIntentService.process(
      userId,
      message,
      from
    );
    if (transferReply) {
      await this.saveMessage(from, "user", message);
      await this.saveMessage(from, "assistant", transferReply);
      await redis.setEx(cacheKey, 3600, JSON.stringify(transferReply));
      return { text: transferReply };
    }

    const systemPrompt = `You are Blocklo Assistant — a smart Nigerian banking AI.

USER CONTEXT:
• Name: ${userContext.name}
• Account: ${userContext.accountNumber}
• Balance: ₦${userContext.balance}
• KYC Level: Tier ${userContext.kycLevel}

Be warm, professional, and speak like a real bank.
Greet by name. Confirm transfers. Never share full BVN/NIN.`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: message },
    ];

    const response = await this.llm.invoke(messages, {
      tools: this.tools,
      tool_choice: "auto",
    });

    let aiReply = "";
    if (response.tool_calls?.length > 0) {
      const toolMessages = [];
      for (const toolCall of response.tool_calls) {
        const result = await this.executeTool(toolCall, { from });
        toolMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.name,
          content: typeof result === "string" ? result : JSON.stringify(result),
        });
      }
      const final = await this.llm.invoke([
        ...messages,
        response,
        ...toolMessages,
      ]);
      aiReply = final.content || "Done!";
    } else {
      aiReply = response.content || "I'm here to help!";
    }

    await this.saveMessage(from, "user", message);
    await this.saveMessage(from, "assistant", aiReply);
    await redis.setEx(cacheKey, 3600, JSON.stringify(aiReply));

    return { text: aiReply };
  }

  async executeTool(toolCall, context) {
    const { name, arguments: args } = toolCall;
    const tool = [...psbFunctions, ...psbVasFunctions].find(
      (t) => t.name === name
    );
    if (!tool) return "Unknown command.";
    try {
      return await tool.handler(args, context);
    } catch (err) {
      return `Error: ${err.message}`;
    }
  }
}

export const langchainService = new LangChainService();

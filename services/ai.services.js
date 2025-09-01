


// import axios from "axios";
// import redis from "../config/redis.js";

// // ✅ LangChain v0.2+ imports (schema utilities moved to @langchain/core)
// import { HumanMessage, AIMessage } from "@langchain/core/messages";

// class AIService {
//   /**
//    * Ask the AI a question and cache the response in Redis.
//    * @param {string} question
//    * @returns {Promise<string>}
//    */
//   async askAI(question) {
//     try {
//       // 🔹 First check Redis cache
//       const cached = await redis.get(question);
//       if (cached) {
//         return JSON.parse(cached);
//       }

//       // 🔹 Call OpenAI (example: GPT-4 chat)
//       const response = await axios.post(
//         "https://api.openai.com/v1/chat/completions",
//         {
//           model: "gpt-4o-mini", // or gpt-4, gpt-3.5-turbo
//           messages: [new HumanMessage(question)],
//         },
//         {
//           headers: {
//             Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
//             "Content-Type": "application/json",
//           },
//         }
//       );

//       const answer = response.data.choices[0].message.content;

//       // 🔹 Cache the answer for 1 hour
//       await redis.set(question, JSON.stringify(answer), "EX", 3600);

//       return answer;
//     } catch (err) {
//       console.error("AIService error:", err.response?.data || err.message);
//       throw new Error("AI processing failed");
//     }
//   }
// }

// export default new AIService();


import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';
import logger from '../config/logger.js';
import UserService from './user.service.js';
import PsbService from './psb.service.js';
import prisma from '../config/prisma.js';
import redis from '../config/redis.js';
import WhatsAppService from './whatsapp.services.js';

class LangChainService {
  constructor() {
    this.llm = new ChatOpenAI({
      apiKey: process.env.LLM_API_KEY, // Use DEEPSEEK_API_KEY
      model: process.env.LLM_MODEL || 'deepseek-chat', // Default to deepseek-chat
      temperature: 0.8,
      configuration: {
        baseURL: process.env.LLM_BASE_URL || 'https://api.deepseek.com', // DeepSeek API endpoint
      },
    });
  }

  /**
   * Process incoming WhatsApp messages and cache responses in Redis
   * @param {string} from - WhatsApp ID (e.g., +2341234567890)
   * @param {string} message - User message
   * @param {string} userId - Prisma user ID
   * @returns {Promise<string>} - Response to send back to user
   */
  async processMessage(from, message, userId) {
    try {
      // Check Redis cache for response
      const cacheKey = `message:${from}:${message}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.info(`Cache hit for message from ${from}: ${message}`);
        return JSON.parse(cached);
      }

      const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
      let response;

      // Handle registration or sign-in via WhatsApp Flow
      if (typeof message === 'string' && (message.toLowerCase().includes('register') || message.toLowerCase().includes('signin'))) {
        const flowId = process.env.WHATSAPP_REGISTRATION_FLOW_ID;
        if (!flowId) {
          logger.error('Missing WHATSAPP_REGISTRATION_FLOW_ID in environment variables');
          response = 'Registration and sign-in are currently unavailable. Please try again later.';
        } else {
          const flowToken = uuidv4();
          await WhatsAppService.sendRegistrationFlow(from, flowId, flowToken);
          response = 'Please complete the form sent to your WhatsApp to register or sign in.';
        }
      } else if (message.toLowerCase().includes('transfer')) {
        response = await this.handleTransfer(from, message, userId);
      } else if (message.toLowerCase().includes('balance')) {
        response = await this.handleBalance(userId);
      } else if (message.toLowerCase().includes('kyc')) {
        response = await this.handleKyc(from, message, userId);
      } else if (message.toLowerCase().includes('kyc status')) {
        response = await this.handleKycStatus(userId);
      } else if (message.toLowerCase().includes('history')) {
        response = await this.handleTransactionHistory(userId);
      } else {
        // Use DeepSeek for natural conversation
        const llmResponse = await this.llm.invoke([
          new HumanMessage(
            `You are a fintech assistant for a WhatsApp-based banking app. User (WhatsApp: ${from}) says: ${message}. Respond naturally, concisely, and assist with their request.`
          ),
        ]);
        response = llmResponse.content;
      }

      // Cache response for 1 hour
      await redis.setEx(cacheKey, 3600, JSON.stringify(response));
      logger.info(`Cached response for ${from}: ${message} -> ${response}`);
      return response;
    } catch (error) {
      logger.error(`LangChain error for ${from}: ${error.message}`);
      return 'Sorry, something went wrong. Please try again.';
    }
  }

  async handleTransfer(from, message, userId) {
    if (!userId) return 'Please register first.';
    const match = message.match(/transfer\s+(\d+\.?\d*)\s+to\s+(\d+)/);
    if (!match) return 'Please provide: transfer <amount> to <accountNumber>';

    const [, amount, accountNumber] = match;
    try {
      const result = await PsbService.initiateTransfer(userId, accountNumber, parseFloat(amount));
      return `Transfer of ${amount} NGN to ${accountNumber} successful! Reference: ${result.reference}`;
    } catch (error) {
      logger.error(`Transfer error for user ${userId}: ${error.message}`);
      return `Transfer failed: ${error.message}`;
    }
  }

  async handleBalance(userId) {
    if (!userId) return 'Please register first.';
    const account = await prisma.account.findFirst({ where: { userId } });
    if (!account) return 'No account found. Create an account first.';
    return `Your balance is ${account.balance} ${account.currency}.`;
  }

  async handleKyc(from, message, userId) {
    if (!userId) return 'Please register first.';
    const match = message.match(/kyc\s+(\d+)/);
    if (!match) return 'Please provide: kyc <bvn>';

    const [, bvn] = match;
    try {
      const result = await UserService.submitKyc(userId, bvn);
      return `KYC verification ${result.status.toLowerCase()}.`;
    } catch (error) {
      logger.error(`KYC error for user ${userId}: ${error.message}`);
      return `KYC verification failed: ${error.message}`;
    }
  }

  async handleKycStatus(userId) {
    if (!userId) return 'Please register first.';
    try {
      const kyc = await UserService.getKycStatus(userId);
      return kyc.status === 'NOT_SUBMITTED'
        ? 'No KYC submitted yet. Use: kyc <bvn>'
        : `Your KYC status is ${kyc.status}. Submitted on ${kyc.createdAt}.`;
    } catch (error) {
      logger.error(`KYC status error for user ${userId}: ${error.message}`);
      return `Failed to get KYC status: ${error.message}`;
    }
  }

  async handleTransactionHistory(userId) {
    if (!userId) return 'Please register first.';
    const transactions = await prisma.transaction.findMany({
      where: { userId },
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { account: true }, // Include account for currency
    });
    if (!transactions.length) return 'No transactions found.';
    return transactions
      .map((tx) => `${tx.type} of ${tx.amount} ${tx.account.currency} on ${tx.createdAt}: ${tx.reference}`)
      .join('\n');
  }
}

export const langchainService = new LangChainService();
export default LangChainService;



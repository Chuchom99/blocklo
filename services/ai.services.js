// src/services/ai.services.js 
import { ChatDeepSeek } from "@langchain/deepseek";
import logger from "../config/logger.js";
import redis from "../config/redis.js";
import prisma from "../config/prisma.js";
import UserService from "./user.service.js";
import crypto from "crypto";
import { psbFunctions, psbVasFunctions } from "../tools/index.js";
import {
  TransferIntentService,
  TransactionHistoryService,
  BeneficiaryIntentService,
  VasIntentService,
  ElectricityBillService,
  CableTVService,
} from "../intent/index.js";
import PsbService from "./psb.service.js";

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
      return null;
    }

    const acc = user.accounts[0];

    // 🔥 GET LIVE PSB BALANCE (clean version)
    const amount = await PsbService.getBalance(acc.accountNumber);
    const liveBalance = amount.toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    return {
      isRegistered: true,
      userId: user.id,
      name: `${user.firstName} ${user.lastName}`.trim(),
      firstName: user.firstName,
      accountNumber: acc.accountNumber,

      balance: liveBalance,

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

    // AUTO-TRIGGER ONBOARDING
    if (
      text.toLowerCase().includes("create account") ||
      text.toLowerCase().includes("start") ||
      text.toLowerCase().includes("register")
    ) {
      if (!userContext || !userContext.isRegistered) {
        return this.startOnboarding(from, profileName);
      }
    }
    if (!userContext) {
      if (
        text.toLowerCase().includes("create account") ||
        text.toLowerCase().includes("start") ||
        text === "hi"
      ) {
        // Trigger onboarding directly
        return this.startOnboarding(from, profileName);
      }

      const welcomeText = `Hi ${
        profileName.split(" ")[0]
      }! Welcome to *Blocklo × 9PSB*\n\nYou haven't created your wallet yet.\n\nReply with *create account* to open your bank account in 60 seconds — right here on WhatsApp!`;
      return { text: welcomeText };
    }

    // ONLY REGISTERED USERS GO TO AI
    return await this.processAIChat(
      from,
      text || "hi",
      userContext,
      userContext.userId
    );
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
    const safeUserId = userContext?.userId || userId;

    // FAST PATH: VAS / BILLS / TRANSFER
    // const vasReply = await VasIntentService.process(userId, message, from);
    // if (vasReply) {
    //   await this.saveMessage(from, "user", message);
    //   await this.saveMessage(from, "assistant", vasReply);
    //   await redis.setEx(cacheKey, 3600, JSON.stringify({ text: vasReply }));
    //   return { text: vasReply };
    // }
    // const vasContext = await redis.get(`vas:${from}`);
    // if (vasContext) {
    //   try {
    //     const ctx = JSON.parse(vasContext);

    //     // SUPPORT BOTH AIRTIME AND DATA
    //     if (
    //       ctx.flow === "airtime" &&
    //       ctx.network &&
    //       ctx.network !== "UNKNOWN"
    //     ) {
    //       const networkEmoji =
    //         { MTN: "MTN", GLO: "GLO", AIRTEL: "AIRTEL", "9MOBILE": "9MOBILE" }[
    //           ctx.network
    //         ] || "";
    //       const reply = `${networkEmoji} Perfect! How much *${ctx.network}* **airtime** do you want?\n\n(₦100 - ₦50,000)`;

    //       await this.saveMessage(from, "assistant", reply);
    //       await redis.setEx(cacheKey, 3600, JSON.stringify(reply));
    //       return { text: reply };
    //     }

    //     if (ctx.flow === "data" && ctx.network && ctx.network !== "UNKNOWN") {
    //       const networkEmoji =
    //         { MTN: "MTN", GLO: "GLO", AIRTEL: "AIRTEL", "9MOBILE": "9MOBILE" }[
    //           ctx.network
    //         ] || "";
    //       const reply = `${networkEmoji} Great! How much *${ctx.network}* **data** do you want to buy?\n\nReply with amount (e.g. *₦500*) or say *plans* to see bundles`;

    //       await this.saveMessage(from, "assistant", reply);
    //       // When user says "buy airtime"
    //       await redis.setEx(
    //         `vas:${from}`,
    //         1800,
    //         JSON.stringify({
    //           flow: "airtime",
    //           step: "awaiting_phone",
    //         })
    //       );
    //       return "Which number do you want to recharge?";

    //       // When user says "buy data"
    //       await redis.setEx(
    //         `vas:${from}`,
    //         1800,
    //         JSON.stringify({
    //           flow: "data",
    //           step: "awaiting_phone",
    //         })
    //       );
    //       return "Which number do you want data for?";
    //       return { text: reply };
    //     }
    //   } catch (err) {
    //     logger.warn("Failed to parse vas context:", err);
    //   }
    // }

    // const billReply = await BillsIntentService.process(userId, message, from);
    // if (billReply) {
    //   await this.saveMessage(from, "user", message);
    //   await this.saveMessage(from, "assistant", billReply);
    //   await redis.setEx(cacheKey, 3600, JSON.stringify(billReply));
    //   return { text: billReply };
    // }

    const beneficiaryReply = await BeneficiaryIntentService.process(
      safeUserId,
      message,
      from
    );
    if (beneficiaryReply) {
      await this.saveMessage(from, "user", message);
      await this.saveMessage(from, "assistant", beneficiaryReply);
      await redis.setEx(
        cacheKey,
        3600,
        JSON.stringify({ text: beneficiaryReply })
      );
      return { text: beneficiaryReply };
    }
    // After beneficiary, before transfer
    const electricityReply = await ElectricityBillService.process(
      userId,
      message,
      from
    );
    if (electricityReply) {
      await this.saveMessage(from, "user", message);
      await this.saveMessage(
        from,
        "assistant",
        electricityReply.text || electricityReply
      );
      await redis.setEx(cacheKey, 3600, JSON.stringify(electricityReply));
      return electricityReply;
    }

    // cable TV INTENT
    const tvReply = await CableTVService.process(userId, message, from);
    if (tvReply) {
      await this.saveMessage(from, "user", message);
      await this.saveMessage(
        from,
        "assistant",
        tvReply.text || tvReply
      );
      await redis.setEx(cacheKey, 3600, JSON.stringify(tvReply));
      return tvReply;
    }

    //VAS INTENT
    const vasReply = await VasIntentService.process(safeUserId, message, from);
    if (vasReply) {
      await this.saveMessage(from, "user", message);
      await this.saveMessage(from, "assistant", vasReply);
      await redis.setEx(cacheKey, 3600, JSON.stringify({ text: vasReply }));
      return { text: vasReply };
    }

    // TRANSFER INTENT
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

    // ────── TRANSACTION HISTORY  ──────

    const historyReply = await TransactionHistoryService.process(
      safeUserId,
      message,
      from
    );
    if (historyReply) {
      await this.saveMessage(from, "user", message);
      await this.saveMessage(
        from,
        "assistant",
        typeof historyReply === "string" ? historyReply : historyReply.text
      );
      await redis.setEx(cacheKey, 3600, JSON.stringify(historyReply));
      return historyReply;
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
        const result = await this.executeTool(toolCall, {
          from,
          userId: userContext.userId,
          userContext,
        });
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

  async executeTool(toolCall, { from, userId, userContext }) {
    const { name, arguments: args } = toolCall;
    const tool = [...psbFunctions, ...psbVasFunctions].find(
      (t) => t.name === name
    );
    if (!tool) return "Sorry, I don't know that command.";

    try {
      // Pass rich context
      return await tool.handler(args, {
        userId,
        from,
        userContext,
      });
    } catch (err) {
      logger.error(`Tool ${name} failed:`, err);
      return `Sorry, that didn't work: ${err.message}`;
    }
  }
}

export const langchainService = new LangChainService();

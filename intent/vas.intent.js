// services/vas.intent.service.js
import PsbVasService from "../services/psb.vas.services.js";
import redis from "../config/redis.js";
import logger from "../config/logger.js";
import prisma from "../config/prisma.js";
import { generateVasReceipt } from "../utils/pdf.vas.utils.js";

export class VasIntentService {
  static async process(userId, message, from) {
    const lower = message.toLowerCase().trim();
    const cacheKey = `vas:${from}`;

    // Step 1: Check for existing VAS flow in Redis
    const existingFlow = await redis.get(cacheKey);
    if (existingFlow) {
      try {
        const flow = JSON.parse(existingFlow);
        return await this.handleFlow(userId, from, message, flow);
      } catch (err) {
        logger.error(`[VAS] Flow parse error: ${err.message}`);
        await redis.del(cacheKey); // Clear bad state
      }
    }

    // Step 2: Detect new VAS intent
    if (lower.includes("airtime") || lower.includes("recharge")) {
      return await this.startAirtimeFlow(userId, from, message);
    }
    if (lower.includes("data") || lower.includes("bundle")) {
      return await this.startDataFlow(userId, from, message);
    }
    if (
      lower.includes("bill") ||
      lower.includes("dstv") ||
      lower.includes("gotv") ||
      lower.includes("electricity") ||
      lower.includes("pay") ||
      lower.includes("cable")
    ) {
      return await this.startBillFlow(userId, from, message);
    }

    // Step 3: Help user if they’re trying but format is wrong
    if (
      lower.includes("buy") ||
      lower.includes("pay") ||
      lower.includes("recharge") ||
      lower.includes("airtime") ||
      lower.includes("data") ||
      lower.includes("bill")
    ) {
      return (
        "I can help you buy airtime, data, or pay bills!\n\n" +
        "• Airtime: `buy 500 airtime for 08012345678`\n" +
        "• Data: `buy 1gb data for 08012345678`\n" +
        "• Bills: `pay DSTV 5000 for 1234567890`\n\n" +
        "Just tell me what you want!"
      );
    }

    return null;
  }

  // ───── AIRTIME FLOW ─────
  static async startAirtimeFlow(userId, from, message) {
    // Match ALL common patterns:
    // buy 500 airtime for 08141921035
    // buy 500 for 08141921035
    // recharge 1000 to 08012345678
    // buy 500 airtime 08141921035
    const patterns = [
      /(?:buy|recharge)\s+(\d+)\s*(?:airtime)?\s*(?:for|to)?\s*(\d{10,11})/i,
      /(?:buy|recharge)\s+(\d+)\s*(?:for|to)?\s*(\d{10,11})/i,
      /(?:buy|recharge)\s+(\d+)\s+(\d{10,11})/i,
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        let [, rawAmount, rawPhone] = match;
        const amount = parseFloat(rawAmount);
        let phone = rawPhone.trim();

        // Normalize phone: remove +234, add leading 0 if needed
        if (phone.startsWith("234")) phone = "0" + phone.slice(3);
        if (phone.length === 10) phone = "0" + phone;
        if (!/^0\d{10}$/.test(phone)) continue; // skip invalid

        return await this.confirmAirtime(userId, from, amount, phone);
      }
    }

    // No match → start flow
    await redis.setEx(
      `vas:${from}`,
      1800,
      JSON.stringify({
        flow: "airtime",
        step: "awaiting_phone",
      })
    );
    return "Which number do you want to buy airtime for? (e.g., 08012345678)";
  }

  // Inside VasIntentService

  static async confirmAirtime(userId, from, amount, phoneNumber) {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum < 50) {
      return "Minimum airtime is ₦50. Please enter a valid amount.";
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { accounts: true },
    });
    if (!user?.accounts?.[0])
      return "Account not found. Say *balance* to refresh.";

    const account = user.accounts[0];

    // Use 9PSB's official network detection
    const { name: networkName, emoji } = await PsbVasService.detectNetwork(
      phoneNumber
    );

    try {
      const response = await PsbVasService.buyAirtime({
        userId,
        accountId: account.id,
        phoneNumber,
        amount: amountNum,
      });

      await redis.del(`vas:${from}`);

      // Generate PDF Receipt
      const receiptPath = await generateVasReceipt({
        ref: response.ref,
        service: "Airtime Top-up",
        amount: amountNum,
        phoneNumber,
        networkEmoji: emoji,
        networkName,
        accountNumber: account.accountNumber,
        customerName: `${user.firstName} ${user.lastName || ""}`.trim(),
      });

      return {
        text:
          `${emoji} *Airtime Purchase Successful!*\n\n` +
          `Amount: ₦${amountNum.toLocaleString()}\n` +
          `Number: ${phoneNumber}\n` +
          `Network: ${networkName}\n` +
          `Ref: ${response.ref}\n` +
          `Date: ${new Date().toLocaleString("en-NG")}\n\n` +
          `Receipt attached`,
        document: {
          url: `http://localhost:5000${receiptPath}`,
          filename: `airtime_${response.ref}.pdf`,
        },
      };
    } catch (error) {
      logger.error(`[VAS] Airtime failed: ${error.message}`);
      return `Failed to buy airtime: ${error.message}`;
    }
  }

  static async selectDataPlan(userId, from, dataSize, phoneNumber) {
    const { name: networkName, emoji } = await PsbVasService.detectNetwork(
      phoneNumber
    );

    let amount, productId;
    const size = dataSize.toLowerCase();
    if (size.includes("mb")) {
      amount = parseFloat(size) * 0.5;
      productId = "DATA_MB";
    } else if (size.includes("gb")) {
      amount = parseFloat(size) * 1000;
      productId = "DATA_GB";
    } else {
      return "Please specify valid data size (e.g., 500MB or 1GB)";
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { accounts: true },
    });
    if (!user?.accounts?.[0]) return "Account not found.";

    const account = user.accounts[0];

    try {
      const response = await PsbVasService.buyData({
        userId,
        accountId: account.id,
        phoneNumber,
        productId,
        amount,
      });

      await redis.del(`vas:${from}`);

      const receiptPath = await generateVasReceipt({
        ref: response.ref,
        service: "Data Bundle",
        amount,
        phoneNumber,
        networkEmoji: emoji,
        networkName,
        accountNumber: account.accountNumber,
        customerName: `${user.firstName} ${user.lastName || ""}`.trim(),
        plan: dataSize.toUpperCase(),
      });

      return {
        text:
          `${emoji} *Data Bundle Purchased!*\n\n` +
          `Plan: ${dataSize.toUpperCase()}\n` +
          `Amount: ₦${amount.toLocaleString()}\n` +
          `Number: ${phoneNumber}\n` +
          `Network: ${networkName}\n` +
          `Ref: ${response.ref}\n\n` +
          `Receipt attached`,
        document: {
          url: `http://localhost:5000${receiptPath}`,
          filename: `data_${response.ref}.pdf`,
        },
      };
    } catch (error) {
      return `Failed to buy data: ${error.message}`;
    }
  }

  // ───── DATA FLOW — FINAL: ₦100 DATA + REAL PLANS + FALLBACK ─────
  static async startDataFlow(userId, from, message) {
    const lower = message.toLowerCase();

    // 1. INSTANT ₦100 DATA (MOST COMMON IN NIGERIA)
    const instantMatch = message.match(
      /(?:buy|get|want)\s*(?:to\s*)?(\d+)\s*(?:data|naira\s*data|data\s*naira)\s*(?:for|to)?\s*(\d{10,11})/i
    );

    if (instantMatch) {
      let [, amountStr, rawPhone] = instantMatch;
      const amount = parseFloat(amountStr);
      let phone = rawPhone.trim();

      // Normalize phone
      if (phone.startsWith("234")) phone = "0" + phone.slice(3);
      if (phone.length === 10) phone = "0" + phone;
      if (!/^0\d{10}$/.test(phone)) {
        return "Please send a valid 11-digit number (e.g., 08012345678)";
      }

      // ₦100–₦1000 = instant data (common in Nigeria)
      if (amount >= 50 && amount <= 2000) {
        return await this.buyInstantData(userId, from, amount, phone);
      }
    }

    // 2. EXTRACT PHONE NUMBER (any position)
    const phoneMatch = message.match(/(\d{10,11})/);
    let phone = null;

    if (phoneMatch) {
      phone = phoneMatch[1];
      if (phone.startsWith("234")) phone = "0" + phone.slice(3);
      if (phone.length === 10) phone = "0" + phone;
    }

    // 3. IF PHONE FOUND → SHOW REAL PLANS
    if (phone && /^0\d{10}$/.test(phone)) {
      await redis.setEx(
        `vas:${from}`,
        1800,
        JSON.stringify({
          flow: "data",
          step: "selecting_plan",
          phone,
        })
      );

      return await this.showDataPlans(userId, from, phone);
    }

    // 4. NO PHONE → ASK FOR IT
    await redis.setEx(
      `vas:${from}`,
      1800,
      JSON.stringify({
        flow: "data",
        step: "awaiting_phone",
      })
    );
    return "Which number do you want data for? (e.g., 08012345678)";
  }

  static async buyInstantData(userId, from, amount, phoneNumber) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { accounts: true },
    });
    if (!user?.accounts?.[0]) return "Account not found.";

    const account = user.accounts[0];
    const { name: networkName, emoji } = await PsbVasService.detectNetwork(
      phoneNumber
    );

    try {
      // 9PSB treats ₦100 data as a special product
      // Most networks: ₦100 = 100MB–150MB daily
      const response = await PsbVasService.buyData({
        userId,
        accountId: account.id,
        phoneNumber,
        productId: "DAILY_100", // or use dynamic from plans
        amount,
      });

      await redis.del(`vas:${from}`);

      const receiptPath = await generateVasReceipt({
        ref: response.ref,
        service: "Instant Data",
        amount,
        phoneNumber,
        networkEmoji: emoji,
        networkName,
        accountNumber: account.accountNumber,
        customerName: `${user.firstName} ${user.lastName || ""}`.trim(),
        plan: "Daily Data",
      });

      return {
        text:
          `${emoji} *Instant Data Purchased!*\n\n` +
          `Amount: ₦${amount.toLocaleString()}\n` +
          `Number: ${phoneNumber}\n` +
          `Network: ${networkName}\n` +
          `Ref: ${response.ref}\n` +
          `Valid: Today only\n\n` +
          `Receipt attached`,
        document: {
          url: `http://localhost:5000${receiptPath}`,
          filename: `instant_data_${response.ref}.pdf`,
        },
      };
    } catch (error) {
      logger.error(`[VAS] Instant data failed: ${error.message}`);
      return `Failed to buy ₦${amount} data: ${error.message}`;
    }
  }

  static async showDataPlans(userId, from, phoneNumber) {
    const plans = await PsbVasService.getDataPlans(phoneNumber);

    if (!plans || plans.length === 0) {
      return "No data plans available right now. Try again later or reply with size (e.g., 1GB).";
    }

    // Sort by price
    plans.sort((a, b) => a.price - b.price);

    let reply = `Available Data Plans for ${phoneNumber}\n\n`;

    const buttons = plans.slice(0, 9).map((plan, i) => ({
      type: "reply",
      reply: {
        id: `DATA_${plan.productId}`,
        title: `${plan.size} ₦${plan.price.toLocaleString()}`,
      },
    }));

    reply += plans
      .slice(0, 9)
      .map(
        (p, i) =>
          `${i + 1}. ${p.size} → ₦${p.price.toLocaleString()} (${p.validity})\n`
      )
      .join("");

    if (plans.length > 9) reply += `\n...and ${plans.length - 9} more`;

    reply += `\n\nReply with number or tap a button below`;

    // Store plans for button selection
    await redis.setEx(
      `data_plans:${from}`,
      1800,
      JSON.stringify({ phone: phoneNumber, plans })
    );

    return {
      type: "interactive",
      payload: {
        type: "button",
        body: { text: reply },
        action: { buttons },
      },
    };
  }

  static async selectDataPlan(userId, from, dataSize, phoneNumber) {
    let amount, productId;
    // Simple mapping for demo (replace with real plans from PsbVasService.getDataPlans)
    if (dataSize.toLowerCase().includes("mb")) {
      amount = parseFloat(dataSize) * 0.5; // e.g., 500MB = ₦250
      productId = "MB_" + dataSize.toUpperCase();
    } else if (dataSize.toLowerCase().includes("gb")) {
      amount = parseFloat(dataSize) * 1000; // e.g., 1GB = ₦1000
      productId = "GB_" + dataSize.toUpperCase();
    } else {
      return "Please specify data size (e.g., 500MB or 1GB).";
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { accounts: true },
    });
    if (!user?.accounts?.[0])
      return "Account not found. Say *balance* to refresh.";

    const accountId = user.accounts[0].id;

    try {
      const response = await PsbVasService.buyData({
        userId,
        accountId,
        phoneNumber,
        productId,
        amount,
      });

      await redis.del(`vas:${from}`);
      return (
        `🎉 Data purchase successful!\n\n` +
        `📶 ${dataSize.toUpperCase()} to ${phoneNumber}\n` +
        `💰 ₦${amount.toLocaleString()}\n` +
        `Ref: ${response.ref}\n` +
        `Date: ${new Date().toLocaleString("en-NG")}`
      );
    } catch (error) {
      logger.error(`[VAS] Data failed: ${error.message}`);
      return `Failed to buy data: ${error.message}. Try again.`;
    }
  }

  static async purchaseDataPlan(userId, from, phoneNumber, plan) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { accounts: true },
    });
    if (!user?.accounts?.[0]) return "Account not found.";

    const account = user.accounts[0];
    const { name: networkName, emoji } = await PsbVasService.detectNetwork(
      phoneNumber
    );

    try {
      const response = await PsbVasService.buyData({
        userId,
        accountId: account.id,
        phoneNumber,
        productId: plan.productId,
        amount: plan.price,
      });

      await redis.del(`vas:${from}`);
      await redis.del(`data_plans:${from}`);

      const receiptPath = await generateVasReceipt({
        ref: response.ref,
        service: "Data Bundle",
        amount: plan.price,
        phoneNumber,
        networkEmoji: emoji,
        networkName,
        accountNumber: account.accountNumber,
        customerName: `${user.firstName} ${user.lastName || ""}`.trim(),
        plan: plan.size,
        validity: plan.validity,
      });

      return {
        text:
          `${emoji} *Data Bundle Purchased!*\n\n` +
          `Plan: ${plan.size} (${plan.validity})\n` +
          `Amount: ₦${plan.price.toLocaleString()}\n` +
          `Number: ${phoneNumber}\n` +
          `Network: ${networkName}\n` +
          `Ref: ${response.ref}\n\n` +
          `Receipt attached`,
        document: {
          url: `http://localhost:5000${receiptPath}`,
          filename: `data_${response.ref}.pdf`,
        },
      };
    } catch (error) {
      return `Failed to buy data: ${error.message}`;
    }
  }

  // // ───── BILL PAYMENT FLOW ─────
  // static async startBillFlow(userId, from, message) {
  //   const match = message.match(
  //     /(?:pay)\s*(dstv|gotv|electricity)\s+(\d+)\s*(?:for|to)?\s*(\w+)/i
  //   );
  //   if (match) {
  //     const [, billType, amount, customerId] = match;
  //     return await this.confirmBill(userId, from, billType, amount, customerId);
  //   }

  //   await redis.setEx(
  //     `vas:${from}`,
  //     1800,
  //     JSON.stringify({
  //       flow: "bill",
  //       step: "awaiting_biller",
  //     })
  //   );
  //   return (
  //     "Which bill do you want to pay?\n\n" +
  //     "• `DSTV` (e.g., pay DSTV 5000 for 1234567890)\n" +
  //     "• `GOTV`\n" +
  //     "• `Electricity`"
  //   );
  // }

  // static async confirmBill(userId, from, billType, amount, customerId) {
  //   const amountNum = parseFloat(amount);
  //   if (isNaN(amountNum) || amountNum < 100)
  //     return "Minimum bill payment is ₦100.";

  //   const user = await prisma.user.findUnique({
  //     where: { id: userId },
  //     include: { accounts: true },
  //   });
  //   if (!user?.accounts?.[0])
  //     return "Account not found. Say *balance* to refresh.";

  //   const accountId = user.accounts[0].id;

  //   // Map billType to billerId (replace with real billerId from PsbVasService.getBillers)
  //   const billerMap = {
  //     dstv: "DSTV_001",
  //     gotv: "GOTV_001",
  //     electricity: "EKEDC_001",
  //   };
  //   const billerId = billerMap[billType.toLowerCase()];
  //   if (!billerId) return "Invalid bill type. Try DSTV, GOTV, or Electricity.";

  //   try {
  //     const response = await PsbVasService.payBill({
  //       userId,
  //       accountId,
  //       billerId,
  //       amount: amountNum,
  //       fields: { customerId },
  //     });

  //     await redis.del(`vas:${from}`);
  //     return (
  //       `🎉 Bill payment successful!\n\n` +
  //       `📺 ${billType.toUpperCase()} for ${customerId}\n` +
  //       `💰 ₦${amountNum.toLocaleString()}\n` +
  //       `Ref: ${response.ref}\n` +
  //       `Date: ${new Date().toLocaleString("en-NG")}`
  //     );
  //   } catch (error) {
  //     logger.error(`[VAS] Bill payment failed: ${error.message}`);
  //     return `Failed to pay bill: ${error.message}. Try again.`;
  //   }
  // }

  // ───── HANDLE FLOW (STATE MACHINE) ─────
  static async handleFlow(userId, from, message, flow) {
    const lower = message.toLowerCase().trim();

    if (flow.flow === "airtime" && flow.step === "awaiting_phone") {
      let phone = message.trim();
      if (phone.startsWith("234")) phone = "0" + phone.slice(3);
      if (phone.length === 10) phone = "0" + phone;

      if (/^0\d{10}$/.test(phone)) {
        await redis.setEx(
          `vas:${from}`,
          1800,
          JSON.stringify({
            flow: "airtime",
            step: "awaiting_amount",
            phone,
          })
        );
        return "How much airtime do you want? (e.g., ₦500)";
      }
      return "Please send a valid 11-digit number (e.g., 08012345678)";
    }

    if (flow.flow === "airtime" && flow.step === "awaiting_amount") {
      const amountMatch = message.match(/(\d+)/);
      if (amountMatch) {
        return await this.confirmAirtime(
          userId,
          from,
          amountMatch[1],
          flow.phone
        );
      }
      return "Please enter the amount (e.g., ₦500).";
    }

    if (flow.flow === "data" && flow.step === "awaiting_phone") {
      let phone = message.trim();
      if (phone.startsWith("234")) phone = "0" + phone.slice(3);
      if (phone.length === 10) phone = "0" + phone;

      if (/^0\d{10}$/.test(phone)) {
        await redis.setEx(
          `vas:${from}`,
          1800,
          JSON.stringify({
            flow: "data",
            step: "awaiting_plan",
            phone,
          })
        );
        return "How much data do you want? (e.g., 500MB, 1GB, 2.5GB)";
      }
      return "Please send a valid 11-digit number (e.g., 08012345678)";
    }

    if (flow.flow === "data" && flow.step === "awaiting_plan") {
      const planMatch = message.match(/(\d+\s*(?:mb|gb))/i);
      if (planMatch) {
        return await this.selectDataPlan(
          userId,
          from,
          planMatch[1],
          flow.phone
        );
      }
      return "Please specify data size (e.g., 500MB or 1GB).";
    }

    if (flow.flow === "data" && flow.step === "selecting_plan") {
      const cached = await redis.get(`data_plans:${from}`);
      if (!cached) return "Session expired. Please start again.";

      const { phone, plans } = JSON.parse(cached);

      // Handle button click (buttonId = DATA_xxx)
      if (message.startsWith("DATA_")) {
        const productId = message;
        const plan = plans.find((p) => p.productId === productId);
        if (!plan) return "Invalid plan selected.";

        return await this.purchaseDataPlan(userId, from, phone, plan);
      }

      // Handle text reply (e.g., "2" or "1GB")
      const numChoice = parseInt(message);
      if (numChoice >= 1 && numChoice <= plans.length) {
        const plan = plans[numChoice - 1];
        return await this.purchaseDataPlan(userId, from, phone, plan);
      }

      // Try size match
      const sizeMatch = message.match(/(\d+(?:\.\d+)?)\s*(mb|gb)/i);
      if (sizeMatch) {
        const size = sizeMatch[1] + sizeMatch[2].toUpperCase();
        const plan = plans.find((p) => p.size.toUpperCase().includes(size));
        if (plan) {
          return await this.purchaseDataPlan(userId, from, phone, plan);
        }
      }

      return "Please select a plan by number or tap a button.";
    }

    if (flow.flow === "bill" && flow.step === "awaiting_biller") {
      const billerMatch = message.match(/(dstv|gotv|electricity)/i);
      if (billerMatch) {
        await redis.setEx(
          `vas:${from}`,
          1800,
          JSON.stringify({
            flow: "bill",
            step: "awaiting_details",
            biller: billerMatch[1].toLowerCase(),
          })
        );
        return `Please provide the ${billerMatch[1]} customer ID and amount (e.g., 1234567890 5000).`;
      }
      return "Please choose a biller: DSTV, GOTV, or Electricity.";
    }

    if (flow.flow === "bill" && flow.step === "awaiting_details") {
      const detailsMatch = message.match(/(\w+)\s+(\d+)/i);
      if (detailsMatch) {
        const [, customerId, amount] = detailsMatch;
        return await this.confirmBill(
          userId,
          from,
          flow.biller,
          amount,
          customerId
        );
      }
      return "Please provide customer ID and amount (e.g., 1234567890 5000).";
    }

    // Fallback: reset bad flow
    await redis.del(`vas:${from}`);
    return "Let’s start over. What do you want to do? Buy airtime, data, or pay a bill?";
  }
}

export default VasIntentService;

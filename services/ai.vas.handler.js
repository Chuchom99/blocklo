// src/services/ai.vas.handler.js
import PsbVasService from "./psb.vas.services.js";
import prisma from "../config/prisma.js";
import logger from "../config/logger.js";

/**
 * AI Handler: Buy Airtime
 */
// src/services/ai.vas.handler.js

export async function handleBuyAirtime(context, args) {
  const { userId, from } = context;
  const { phoneNumber, amount } = args || {};  // ← args is the second param!

  try {
    const account = await prisma.account.findFirst({ where: { userId } });
    if (!account) return "No wallet found. Please register.";

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum < 100)
      return "Minimum airtime is ₦100.";

    // if (account.balance < amountNum)
    //   return `Insufficient balance. You need ₦${amountNum}, have ₦${account.balance.toFixed(2)}`;

    const response = await PsbVasService.buyAirtime({
      userId,
      accountId: account.id,
      phoneNumber,
      amount: amountNum,
    });

    // Now safe to delete
    await redis.del(`vas:${from}`);

    return `Airtime ₦${amountNum} sent to ${phoneNumber}! Ref: ${
      response.data?.transactionReference || "N/A"
    }`;
  } catch (err) {
    logger.error(`[AI VAS] Airtime failed: ${err.message}`);
    await redis.del(`vas:${from}`);
    return `Failed to buy airtime: ${err.message}`;
  }
}
/**
 * AI Handler: Buy Data
 */
export async function handleBuyData(userId, { phoneNumber, productId }) {
  try {
    const account = await prisma.account.findFirst({ where: { userId } });
    if (!account) return "No wallet found.";

    // Fetch data plans to get price
    const plansRes = await PsbVasService.getDataPlans(phoneNumber);
    const plan = plansRes.data?.find((p) => p.productId === productId);
    if (!plan) return "Invalid data plan. Use: list data plans";

    const amount = parseFloat(plan.amount);
    if (account.balance < amount)
      return `Need ₦${amount}, you have ₦${account.balance.toFixed(2)}`;

    const response = await PsbVasService.buyData({
      userId,
      accountId: account.id,
      phoneNumber,
      productId,
      amount,
    });

    await redis.del(`vas:${from}`);
    return `${plan.productName} sent to ${phoneNumber}! Ref: ${
      response.data?.transactionReference || "N/A"
    }`;
  } catch (err) {
    logger.error(`[AI VAS] Data failed: ${err.message}`);
    return `Failed to buy data: ${err.message}`;
  }
}

/**
 * AI Handler: List Data Plans
 */
export async function handleListDataPlans(userId, { phoneNumber }) {
  try {
    const plansRes = await PsbVasService.getDataPlans(phoneNumber);
    const plans = plansRes.data || [];

    if (plans.length === 0) return "No data plans available for this number.";

    const list = plans
      .slice(0, 8)
      .map((p) => `• ${p.productName} - ₦${p.amount}`)
      .join("\n");
    await redis.del(`vas:${from}`);
    return `Data Plans for ${phoneNumber}:\n${list}\nReply with: buy data [productId]`;
  } catch (err) {
    return "Could not fetch data plans.";
  }
}

/**
 * AI Handler: Pay Bill
 */
export async function handlePayBill(userId, { billerId, amount, fields }) {
  try {
    const account = await prisma.account.findFirst({ where: { userId } });
    if (!account) return "No wallet found.";

    const amountNum = parseFloat(amount);
    if (account.balance < amountNum)
      return `Need ₦${amountNum}, you have ₦${account.balance.toFixed(2)}`;

    const response = await PsbVasService.payBill({
      userId,
      accountId: account.id,
      billerId,
      amount: amountNum,
      fields,
    });

    await redis.del(`vas:${from}`);
    return `Bill paid! ₦${amountNum} to ${fields?.meterNo || billerId}. Ref: ${
      response.data?.transactionReference || "N/A"
    }`;
  } catch (err) {
    logger.error(`[AI VAS] Bill pay failed: ${err.message}`);
    return `Bill payment failed: ${err.message}`;
  }
}

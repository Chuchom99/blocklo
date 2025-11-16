
import prisma from "../config/prisma.js";
import PsbVasService from "./psb.vas.services.js";
import logger from "../config/logger.js";

export class VasIntentService {
  // === 1. AIRTIME ===
  static async handleAirtime(userId, message) {
    const match = message.match(/buy\s+(\d+)\s*mtn\s*airtime\s*to\s*(\d{11})/i);
    if (!match) return null;

    const amount = match[1];
    const phoneNumber = match[2];

    const account = await prisma.account.findFirst({ where: { userId } });
    if (!account) return "No wallet found. Please register.";

    const payload = { userId, accountId: account.id, phoneNumber, amount };

    try {
      const result = await PsbVasService.buyAirtime(payload);
      return `Airtime ₦${amount} sent to ${phoneNumber}! Ref: ${result.data?.transactionReference || "N/A"}`;
    } catch (err) {
      logger.error(`[VAS] Airtime failed: ${err.message}`);
      return `Failed: ${err.message}`;
    }
  }

  // === 2. DATA PURCHASE ===
  static async handleData(userId, message) {
    const match = message.match(/buy\s+(\w+)\s*data\s*for\s*(\d{11})/i);
    if (!match) return null;

    const productId = match[1].toUpperCase();
    const phoneNumber = match[2];

    const account = await prisma.account.findFirst({ where: { userId } });
    if (!account) return "No wallet.";

    const plansRes = await PsbVasService.getDataPlans(phoneNumber);
    const plan = plansRes.data?.find(p => p.productId === productId);
    if (!plan) return `Invalid plan. Use: list data plans for ${phoneNumber}`;

    const payload = {
      userId,
      accountId: account.id,
      phoneNumber,
      productId,
      amount: plan.amount,
    };

    try {
      const result = await PsbVasService.buyData(payload);
      return `${plan.productName} sent to ${phoneNumber}!`;
    } catch (err) {
      return `Failed: ${err.message}`;
    }
  }

  // === 3. LIST DATA PLANS ===
static async handleListDataPlans(userId, message) {
  // ── NEW FLEXIBLE REGEX ────────────────────────────────────────
  // Matches:
  //   "check data plans mtn number 08141921035"
  //   "check available data plans mtn number 08141921035"
  //   "list data plans for 08141921035"
  //   "show mtn plans 08141921035"
  const match = message.match(
    /(?:check|show|list|available|view)\s+(?:data\s+)?plans?\s+(?:mtn\s+)?(?:number\s+)?(\d{11})/i
  );
  if (!match) return null;

  const phoneNumber = match[1];

  try {
    const plansRes = await PsbVasService.getDataPlans(phoneNumber);
    const plans = plansRes.data || [];

    if (!plans.length) return "No data plans found for this number.";

    // ── PRETTY FORMAT (first 10 plans – WhatsApp limit) ───────
    const topPlans = plans.slice(0, 10).map(p => 
      `• ${p.dataBundle} – ₦${p.amount} (${p.validity})`
    ).join("\n");

    const more = plans.length > 10
      ? `\n\n...and ${plans.length - 10} more. Reply *more* to see all.`
      : "";

    return `MTN Data Plans for ${phoneNumber}:\n${topPlans}${more}\n\nReply: *buy [productId] data*`;
  } catch (err) {
    logger.error(`[VAS] Data plans error: ${err.message}`);
    return "Sorry, I couldn't fetch the plans right now. Try again later.";
  }
}


static async handleShowMorePlans(userId, message, from) {
  if (!message.toLowerCase().includes("more")) return null;

  // Re‑run the same logic but return **all** plans
  const lastMatch = await redis.get(`last_plan_query:${from}`);
  if (!lastMatch) return "No previous plan query. Try: check data plans mtn 08141921035";

  const phoneNumber = lastMatch;
  const plansRes = await PsbVasService.getDataPlans(phoneNumber);
  const plans = plansRes.data || [];

  const all = plans.map(p => 
    `• ${p.productId} – ${p.dataBundle} – ₦${p.amount} (${p.validity})`
  ).join("\n");

  return `All MTN Plans for ${phoneNumber}:\n${all}`;
}

static async handleYesBuyData(userId, message, from) {
  if (!message.toLowerCase().includes("yes")) return null;

  const last = await redis.get(`last_data_plan:${from}`);
  if (!last) return "No previous plan. Try: list data plans for 08141921035";

  const plan = JSON.parse(last);
  const account = await prisma.account.findFirst({ where: { userId } });
  if (!account) return "No wallet.";

  const payload = {
    userId,
    accountId: account.id,
    phoneNumber: plan.phoneNumber,
    productId: plan.productId,
    amount: plan.amount,
  };

  try {
    const result = await PsbVasService.buyData(payload);
    return `${plan.dataBundle} (₦${plan.amount}) sent to ${plan.phoneNumber}!\n` +
           `Ref: ${result.data?.transactionReference || "N/A"}`;
  } catch (err) {
    return `Failed: ${err.message}`;
  }
}

  // === 4. BILL PAYMENT ===
  static async handleBillPayment(userId, message) {
    const match = message.match(/pay\s+(\d+)\s*for\s*meter\s*(\w+)/i);
    if (!match) return null;

    const  amount = match[1];
    const meterNo = match[2];

    const account = await prisma.account.findFirst({ where: { userId } });
    if (!account) return "No wallet.";

    const payload = {
      userId,
      accountId: account.id,
      billerId: "IKEDC_PREPAID",
      amount,
      fields: { meterNo },
    };

    try {
      const result = await PsbVasService.payBill(payload);
      return `Bill ₦${amount} paid for meter ${meterNo}!`;
    } catch (err) {
      return `Failed: ${err.message}`;
    }
  }

  // === MAIN ROUTER ===
  static async process(userId, message) {
    const handlers = [
      this.handleAirtime,
      this.handleData,
      this.handleListDataPlans,
      this.handleShowMorePlans,
      this.handleYesBuyData,
    //   this.handleBillPayment,
    ];

    for (const handler of handlers) {
      const result = await handler(userId, message);
      if (result) return result;
    }

    return null; // Not a VAS command
  }
}
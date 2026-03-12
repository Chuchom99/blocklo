// intent/vas.intent.js
import prisma from "../config/prisma.js";
import PsbVasService from "../services/psb.vas.services.js";
import PsbService from "../services/psb.service.js"; // for balance
import logger from "../config/logger.js";
import redis from "../config/redis.js";

const REDIS_KEY = (from) => `vas:${from}`;

// small helpers
const normalizePhone = (p) =>
  p?.toString().replace(/[^\d]/g, "")?.replace(/^234/, "0") || p;

const looksLikePhone = (s) => {
  const cleaned = s?.toString().replace(/[^\d]/g, "");
  // Accept 10 (without leading 0), 11 (with 0) or +234...
  return (
    /^(?:234)?0?7|^(?:234)?0?8|^(?:234)?0?9/.test(cleaned) &&
    cleaned.length >= 10
  );
};

export class VasIntentService {
  // entrypoint: returns text reply or null
  static async process(userId, message, from) {
    const msg = (message || "").trim();

    // 1) if there's an active vas flow in redis, route it
    const flowRaw = await redis.get(REDIS_KEY(from));
    if (flowRaw) {
      try {
        const ctx = JSON.parse(flowRaw);
        return await this._continueFlow(userId, msg, from, ctx);
      } catch (err) {
        logger.warn("[VAS] invalid ctx", err.message);
        await redis.del(REDIS_KEY(from));
      }
    }

    // 2) Quick deterministic intent checks (in order)
    // - exact buy commands
    const buyMatch1 = msg.match(
      /^(?:buy|recharge|topup)\s+(\d{1,7})\s*(?:naira|₦|n)?\s*(?:to)?\s*(\+?\d{10,14})$/i
    );
    const buyMatch2 = msg.match(/^(\+?\d{10,14})\s+(\d{1,7})$/); // e.g., "08141921035 100"
    const buyKeyword = /(?:buy|airtime|recharge|top ?up)/i.test(msg);

    // list plans
    // detect phrases like "mtn data bundles", "glo bundles", "airtel data", etc.
    const networkPlansMatch = msg.match(
      /(mtn|glo|airtel|9mobile)\s+(?:data\s+)?bundles?/i
    );

    const plansMatch = msg.match(
      /(?:plans|list data|show plans|data plans)\s*(\+?\d{10,14})?/i
    );

    if (networkPlansMatch) {
      const network = networkPlansMatch[1].toLowerCase();
      const phone = normalizePhone(
        (await redis.get(`last_plan_query:${from}`)) || ""
      );

      if (!phone)
        return `Please provide the phone number (e.g. 08141921035) to fetch ${network.toUpperCase()} data bundles.`;

      try {
        const plansRes = await PsbVasService.getDataPlans(phone);
        const plans = (plansRes.data || []).filter((p) =>
          p.productName.toLowerCase().includes(network)
        );

        if (!plans.length)
          return `No ${network.toUpperCase()} plans found for ${phone}.`;

        await redis.setEx(`last_plan_query:${from}`, 3600, phone);

        const list = plans
          .slice(0, 12)
          .map((p) => `• ${p.productId} — ${p.productName} — ₦${p.amount}`)
          .join("\n");

        return `Here are ${network.toUpperCase()} data bundles for ${phone}:\n\n${list}\n\nReply with: buy [productId] data`;
      } catch (err) {
        logger.error("[VAS] getDataPlans network-filter error", err.message);
        return "Could not fetch plans right now. Try again shortly.";
      }
    }

    // short "buy [code] data" e.g. "buy DAILY1 data for 0814..."
    const dataCodeMatch = msg.match(
      /buy\s+([A-Z0-9_-]+)\s+data(?:\s+for\s+(\+?\d{10,14}))?/i
    );

    // If a direct "buy [amount] to phone" style is used
    if (
      buyMatch1 ||
      buyMatch2 ||
      (buyKeyword && looksLikePhone(msg.split(/\s+/)[0]))
    ) {
      // set a flow in redis and ask for confirmation / amount if missing
      // extract phone/amount robustly
      let phone, amount;
      if (buyMatch1) {
        amount = buyMatch1[1];
        phone = buyMatch1[2];
      } else if (buyMatch2) {
        phone = buyMatch2[1];
        amount = buyMatch2[2];
      } else {
        // fallback: "buy airtime" or "recharge"
        await redis.setEx(
          REDIS_KEY(from),
          1800,
          JSON.stringify({ flow: "airtime", step: "awaiting_phone" })
        );
        return "Which number do you want to recharge? Reply with the phone number.";
      }

      phone = normalizePhone(phone);
      // store flow and continue to automatic path
      const network = PsbVasService.detectNetwork(phone);
      const ctx = {
        flow: "airtime",
        step: "confirm",
        phone,
        amount: Number(amount),
        network,
      };
      await redis.setEx(REDIS_KEY(from), 1800, JSON.stringify(ctx));

      // quick auto-run: try to process immediately
      return await this._continueFlow(userId, `${phone} ${amount}`, from, ctx);
    }

    // data-specific
    if (dataCodeMatch) {
      const productId = dataCodeMatch[1].toUpperCase();
      const phone = normalizePhone(
        dataCodeMatch[2] || (await redis.get(`last_plan_query:${from}`)) || ""
      );
      if (!phone) {
        await redis.setEx(
          REDIS_KEY(from),
          1800,
          JSON.stringify({ flow: "data", step: "awaiting_phone", productId })
        );
        return "Which number do you want to buy the data for?";
      }
      const ctx = { flow: "data", step: "confirm", phone, productId };
      await redis.setEx(REDIS_KEY(from), 1800, JSON.stringify(ctx));
      return await this._continueFlow(
        userId,
        `confirm ${productId}`,
        from,
        ctx
      );
    }

    // list data plans
    if (plansMatch) {
      const phone = normalizePhone(
        plansMatch[1] || (await redis.get(`last_plan_query:${from}`)) || ""
      );
      if (!phone)
        return "Reply with the phone number to see data plans (e.g. 08141921035).";
      try {
        const plansRes = await PsbVasService.getDataPlans(phone);
        const plans = plansRes.data || [];
        if (!plans.length) return "No data plans found for that number.";
        await redis.setEx(`last_plan_query:${from}`, 3600, phone);
        const top = plans
          .slice(0, 8)
          .map((p) => `• ${p.productId} — ${p.productName} — ₦${p.amount}`)
          .join("\n");
        return `Data plans for ${phone}:\n${top}\nReply with: buy [productId] data for ${phone}`;
      } catch (err) {
        logger.error("[VAS] getDataPlans failed", err.message);
        return "Could not fetch plans right now. Try again shortly.";
      }
    }

    // otherwise not a VAS intent
    return null;
  }

  // continue an existing flow
  static async _continueFlow(userId, message, from, ctx) {
    // ctx: { flow, step, phone?, amount?, productId?, network? }
    const lower = message.trim().toLowerCase();

    // AIRTIME FLOW
    if (ctx.flow === "airtime") {
      if (ctx.step === "awaiting_phone") {
        const phone = normalizePhone(message);
        if (!looksLikePhone(phone))
          return "Please reply with a valid phone number (e.g. 08141921035).";
        ctx.phone = phone;
        ctx.network = PsbVasService.detectNetwork(phone);
        ctx.step = "awaiting_amount";
        await redis.setEx(REDIS_KEY(from), 1800, JSON.stringify(ctx));
        return `Got it. How much airtime for ${phone}? (₦100 - ₦50,000)`;
      }

      if (ctx.step === "awaiting_amount") {
        const m = message.match(/(\d{2,6})/);
        if (!m) return "Please reply with amount in Naira (e.g. 500).";
        ctx.amount = Number(m[1]);
        ctx.step = "confirm";
        await redis.setEx(REDIS_KEY(from), 1800, JSON.stringify(ctx));
        return `Confirm: buy ₦${ctx.amount.toLocaleString(
          "en-NG"
        )} airtime for ${ctx.phone}? Reply *yes* to proceed.`;
      }

      if (ctx.step === "confirm") {
        if (!/^(yes|y|confirm)$/i.test(message))
          return "Reply *yes* to confirm or *no* to cancel.";
        // Proceed to purchase: check PSB balance then call PSB
        try {
          const account = await prisma.account.findFirst({ where: { userId } });
          if (!account) return "No wallet found. Please register.";

          const psbBalance = await PsbService.getBalance(account.accountNumber);
          if (psbBalance < ctx.amount) {
            await redis.del(REDIS_KEY(from));
            return `Insufficient funds. Your balance is ₦${psbBalance.toLocaleString(
              "en-NG",
              { minimumFractionDigits: 2 }
            )}. Please fund and try again.`;
          }

          // Call PSB VAS buyAirtime (this function creates transaction and updates DB in your service)
          const payload = {
            userId,
            accountId: account.id,
            phoneNumber: ctx.phone,
            amount: ctx.amount,
          };

          // mark step processing
          ctx.step = "processing";
          await redis.setEx(REDIS_KEY(from), 600, JSON.stringify(ctx));

          const res = await PsbVasService.buyAirtime(payload);

          // PSB returned; clear flow
          await redis.del(REDIS_KEY(from));

          if (
            res?.status?.toUpperCase() === "SUCCESS" ||
            res?.status === "success"
          ) {
            const ref =
              res.data?.transactionReference || res.data?.reference || "N/A";
            // optionally fetch new balance
            const newBal = await PsbService.getBalance(account.accountNumber);
            return `✅ Airtime ₦${ctx.amount.toLocaleString("en-NG")} sent to ${
              ctx.phone
            }.\nRef: ${ref}\nBalance: ₦${newBal.toLocaleString("en-NG", {
              minimumFractionDigits: 2,
            })}`;
          } else {
            logger.error("[VAS] buyAirtime non-success", { res });
            return `Airtime purchase failed: ${
              res?.message || "Unknown error"
            }.`;
          }
        } catch (err) {
          await redis.del(REDIS_KEY(from));
          logger.error("[VAS] buyAirtime error", {
            message: err.message,
            response: err.response?.data,
            status: err.response?.status,
          });
          return `Airtime purchase failed: ${
            err.message || "Try again later."
          }`;
        }
      }

      // default
      return "Airtime flow: unexpected state. Please start again with 'buy airtime'.";
    }

    // DATA FLOW
    if (ctx.flow === "data") {
      if (ctx.step === "awaiting_phone") {
        const phone = normalizePhone(message);
        if (!looksLikePhone(phone))
          return "Please reply with a valid phone number.";
        ctx.phone = phone;
        ctx.step = "awaiting_plan";
        await redis.setEx(REDIS_KEY(from), 1800, JSON.stringify(ctx));
        return `Which plan code do you want? Reply *plans* to see bundles.`;
      }

      if (ctx.step === "awaiting_plan") {
        // user can reply with productId or 'plans'
        if (/plans?/i.test(message)) {
          try {
            const plansRes = await PsbVasService.getDataPlans(ctx.phone);
            const plans = plansRes.data || [];
            await redis.setEx(`last_plan_query:${from}`, 3600, ctx.phone);
            if (!plans.length) return "No plans found for that number.";
            await redis.setEx(REDIS_KEY(from), 1800, JSON.stringify(ctx));
            return (
              plans
                .slice(0, 8)
                .map((p) => `${p.productId} — ${p.productName} — ₦${p.amount}`)
                .join("\n") + `\nReply with the productId to buy.`
            );
          } catch (err) {
            logger.error("[VAS] getDataPlans error", err.message);
            return "Could not fetch plans right now.";
          }
        }

        const pid = message.trim().toUpperCase();
        ctx.productId = pid;
        // fetch plan details to know amount
        try {
          const plansRes = await PsbVasService.getDataPlans(ctx.phone);
          const plan = plansRes.data?.find((p) => p.productId === pid);
          if (!plan)
            return "Invalid product code. Reply *plans* to see options.";
          ctx.amount = Number(plan.amount);
          ctx.step = "confirm";
          await redis.setEx(REDIS_KEY(from), 1800, JSON.stringify(ctx));
          return `Confirm: buy ${plan.productName} (₦${plan.amount}) for ${ctx.phone}? Reply *yes* to proceed.`;
        } catch (err) {
          logger.error("[VAS] getDataPlans error", err.message);
          return "Could not validate plan. Try again later.";
        }
      }

      if (ctx.step === "confirm") {
        if (!/^(yes|y|confirm)$/i.test(message))
          return "Reply *yes* to confirm or *no* to cancel.";
        try {
          const account = await prisma.account.findFirst({ where: { userId } });
          if (!account) return "No wallet found.";

          const psbBalance = await PsbService.getBalance(account.accountNumber);
          if (psbBalance < ctx.amount) {
            await redis.del(REDIS_KEY(from));
            return `Insufficient funds. Your balance is ₦${psbBalance.toLocaleString(
              "en-NG",
              { minimumFractionDigits: 2 }
            )}.`;
          }

          ctx.step = "processing";
          await redis.setEx(REDIS_KEY(from), 600, JSON.stringify(ctx));

          const payload = {
            userId,
            accountId: account.id,
            phoneNumber: ctx.phone,
            productId: ctx.productId,
            amount: String(ctx.amount),
          };

          const res = await PsbVasService.buyData(payload);
          await redis.del(REDIS_KEY(from));

          if (
            res?.status?.toUpperCase() === "SUCCESS" ||
            res?.status === "success"
          ) {
            const ref =
              res.data?.transactionReference || res.data?.reference || "N/A";
            const newBal = await PsbService.getBalance(account.accountNumber);
            return `✅ ${ctx.productId} sent to ${
              ctx.phone
            }.\nRef: ${ref}\nBalance: ₦${newBal.toLocaleString("en-NG", {
              minimumFractionDigits: 2,
            })}`;
          } else {
            logger.error("[VAS] buyData non-success", { res });
            return `Data purchase failed: ${res?.message || "Unknown"}`;
          }
        } catch (err) {
          await redis.del(REDIS_KEY(from));
          logger.error("[VAS] buyData error", {
            message: err.message,
            response: err.response?.data,
          });
          return `Data purchase failed: ${err.message || "Try again later."}`;
        }
      }
    }

    // fallback
    return null;
  }
}

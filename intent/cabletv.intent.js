// services/cabletv.bill.service.js
import PsbVasService from "../services/psb.vas.services.js";
import redis from "../config/redis.js";
import logger from "../config/logger.js";
import prisma from "../config/prisma.js";
import { generateVasReceipt } from "../utils/pdf.vas.utils.js";

const CABLE_TV_CATEGORY_ID = "4";

export class CableTVService {
  static async process(userId, message, from) {
    const lower = message.toLowerCase().trim();
    const keywords = ["dstv", "gotv", "startimes", "tv", "cable", "subscription", "bouquet"];
    if (!keywords.some(k => lower.includes(k))) return null;

    const cacheKey = `bill_tv:${from}`;
    const existing = await redis.get(cacheKey);
    if (existing) {
      const flow = JSON.parse(existing);
      return await this.handleFlow(userId, from, message, flow);
    }

    await redis.setEx(cacheKey, 3600, JSON.stringify({ step: "select_provider" }));
    return await this.showProviders(userId, from);
  }

  static async showProviders(userId, from) {
    try {
      const response = await PsbVasService.getCategoryBillers(CABLE_TV_CATEGORY_ID);
      const billers = response.data || [];

      const popular = billers.filter(b => 
        ["CW-DSTV", "CW-GOTV", "CW-STARTIMES"].includes(b.id)
      );

      let text = "*Select Your TV Provider*\n\n";
      const buttons = popular.map(b => ({
        type: "reply",
        reply: { id: `TV_${b.id}`, title: b.name },
      }));

      popular.forEach((b, i) => text += `${i + 1}. ${b.name}\n`);

      return {
        type: "interactive",
        payload: {
          type: "button",
          body: { text },
          action: { buttons },
        },
      };
    } catch (error) {
      return "TV providers temporarily unavailable. Try again.";
    }
  }

  static async handleFlow(userId, from, message, flow) {
    const cacheKey = `bill_tv:${from}`;

    if (flow.step === "select_provider") {
      let billerId = null;
      let billerName = "";

      if (message.startsWith("TV_")) {
        billerId = message.replace("TV_", "");
      } else {
        const map = {
          dstv: "CW-DSTV",
          gotv: "CW-GOTV",
          startimes: "CW-STARTIMES",
        };
        billerId = map[message.toLowerCase()];
        billerName = message.toUpperCase();
      }

      const validIds = ["CW-DSTV", "CW-GOTV", "CW-STARTIMES"];
      if (!validIds.includes(billerId)) {
        return "Please select DSTV, GOTV, or Startimes.";
      }

      await redis.setEx(cacheKey, 3600, JSON.stringify({
        step: "enter_smartcard",
        billerId,
        billerName: billerName || billerId.replace("CW-", ""),
      }));

      return `Selected *${billerName || billerId.replace("CW-", "")}*\n\nPlease send your Smart Card / IUC Number`;
    }

    if (flow.step === "enter_smartcard") {
      const smartcard = message.trim();
      if (!/^\d{10,12}$/.test(smartcard)) {
        return "Invalid Smart Card number. Must be 10–12 digits.";
      }

      await redis.setEx(cacheKey, 3600, JSON.stringify({
        ...flow,
        step: "select_bouquet",
        smartcard,
      }));

      return await this.showBouquets(userId, from, flow.billerId, smartcard);
    }

    if (flow.step === "select_bouquet") {
      // Handle button or text selection
      const cached = await redis.get(`tv_bouquets:${from}`);
      if (!cached) return "Session expired. Start again.";

      const { bouquets } = JSON.parse(cached);
      let selected = null;

      if (message.startsWith("BOUQUET_")) {
        const id = message.replace("BOUQUET_", "");
        selected = bouquets.find(b => b.itemId === id);
      } else {
        const num = parseInt(message);
        if (num >= 1 && num <= bouquets.length) {
          selected = bouquets[num - 1];
        }
      }

      if (!selected) return "Invalid selection. Tap a button or reply with number.";

      return await this.confirmAndPay(userId, from, {
        ...flow,
        bouquet: selected,
      });
    }
  }

  static async showBouquets(userId, from, billerId, smartcard) {
    try {
      const fields = await PsbVasService.getBillerFields(billerId);
      const amountField = fields.data.find(f => f.fieldName === "itemId");
      const bouquets = amountField?.items || [];

      if (bouquets.length === 0) {
        return "No bouquets available right now.";
      }

      let text = `Smart Card: *${smartcard}*\n\nSelect Bouquet:\n\n`;
      const buttons = bouquets.slice(0, 3).map(b => ({
        type: "reply",
        reply: { id: `BOUQUET_${b.itemId}`, title: `${b.itemName.split(" - ")[0]}` },
      }));

      bouquets.forEach((b, i) => {
        text += `${i + 1}. ${b.itemName}\n`;
      });

      await redis.setEx(`tv_bouquets:${from}`, 3600, JSON.stringify({ bouquets }));

      return {
        type: "interactive",
        payload: {
          type: "button",
          body: { text },
          action: { buttons },
        },
      };
    } catch (error) {
      return "Could not load bouquets. Try again.";
    }
  }

  static async confirmAndPay(userId, from, flow) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { accounts: true },
    });
    if (!user?.accounts?.[0]) return "Account not found.";

    const account = user.accounts[0];

    try {
      const payload = {
        billerId: flow.billerId,
        customerId: flow.smartcard,
        amount: flow.bouquet.amount,
        itemId: flow.bouquet.itemId,
      };

      const response = await PsbVasService.payBill({
        userId,
        accountId: account.id,
        billerId: flow.billerId,
        amount: flow.bouquet.amount,
        fields: payload,
      });

      await redis.del(`bill_tv:${from}`);
      await redis.del(`tv_bouquets:${from}`);

      const receiptPath = await generateVasReceipt({
        ref: response.ref,
        service: "Cable TV Payment",
        amount: parseFloat(flow.bouquet.amount),
        phoneNumber: user.phone || "N/A",
        networkEmoji: "Television",
        networkName: flow.billerName,
        accountNumber: account.accountNumber,
        customerName: `${user.firstName} ${user.lastName || ""}`.trim(),
        smartcard: flow.smartcard,
        bouquet: flow.bouquet.itemName,
      });

      return {
        text:
          `Cable TV Payment Successful!\n\n` +
          `Provider: ${flow.billerName}\n` +
          `Smart Card: ${flow.smartcard}\n` +
          `Bouquet: ${flow.bouquet.itemName}\n` +
          `Amount: ₦${parseFloat(flow.bouquet.amount).toLocaleString()}\n` +
          `Ref: ${response.ref}\n\n` +
          `Receipt attached`,
        document: {
          url: `http://localhost:5000${receiptPath}`,
          filename: `tv_${flow.smartcard}.pdf`,
        },
      };
    } catch (error) {
      return `Payment failed: ${error.message}`;
    }
  }
}

export default CableTVService;
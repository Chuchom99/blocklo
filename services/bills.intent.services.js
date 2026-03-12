// src/services/bills-intent.service.js
import prisma from "../config/prisma.js";
import PsbVasService from "./psb.vas.services.js";
import logger from "../config/logger.js";
import redis from "../config/redis.js";

export class BillsIntentService {
  // === 1. LIST CATEGORIES ===
  static async handleListCategories(userId, message) {
    if (
      !message.toLowerCase().includes("bill") &&
      !message.toLowerCase().includes("category")
    )
      return null;

    try {
      const res = await PsbVasService.getBillCategories();
      const cats = res.data || [];

      const list = cats.map((c) => `• ${c.name}`).join("\n");
      return `Available Bill Categories:\n${list}\n\nReply with a category (e.g., *GOTV*) to see plans.`;
    } catch (err) {
      return "Could not fetch categories.";
    }
  }

  // === 2. LIST BILLERS (e.g., "GOTV") ===
  static async handleListBillers(userId, message) {
    const intent = message.toLowerCase();
    const keywords = {
      gotv: /gotv|go tv/i,
      dstv: /dstv|d stv/i,
      startimes: /startimes|star times/i,
      electricity: /electricity|light|power|ikeja|eko|prepaid/i,
      internet: /internet|wifi|broadband/i,
    };

    let category = null;
    for (const [key, regex] of Object.entries(keywords)) {
      if (regex.test(intent)) {
        category = key.toUpperCase();
        break;
      }
    }
    if (!category) return null;

    const catMap = {
      GOTV: "4",
      DSTV: "4",
      STARTIMES: "4",
      ELECTRICITY: "1",
      INTERNET: "7",
    };
    const catId = catMap[category];
    if (!catId) return null;

    try {
      const res = await PsbVasService.getCategoryBillers(catId); // FIXED
      const billers = res.data || [];

      const list = billers.map((b) => `• ${b.name} (${b.id})`).join("\n");
      return `${category} Billers:\n${list}\n\nReply with a biller (e.g., *CW-GOTV*) to see plans.`;
    } catch (err) {
      logger.error(`[BILLS] List billers error: ${err.message}`);
      return "Could not fetch billers.";
    }
  }

  // === 3. LIST BOUQUETS ===
  static async handleListBouquets(userId, message, from) {
    const match = message.match(/(CW-\w+|BX-\w+)/i);
    if (!match) return null;

    const billerId = match[0].toUpperCase();

    try {
      const res = await PsbVasService.getBillerFields(billerId);
      const fields = res.data || [];

      const bouquetField = fields.find((f) => f.isSelectData === "Y");
      if (!bouquetField?.items?.length) {
        return `No bouquets for ${billerId}.`;
      }

      const list = bouquetField.items
        .map((i) => `• ${i.itemName} – ₦${i.amount}`)
        .join("\n");

      await redis.setEx(
        `bill_context:${from}`,
        3600,
        JSON.stringify({
          billerId,
          customerField:
            fields.find((f) => f.fieldName === "customerId")
              ?.fieldDescription || "Smartcard",
        })
      );

      return `${billerId} Plans:\n${list}\n\nReply with your **smartcard number**.`;
    } catch (err) {
      logger.error(`[BILLS] Bouquets error: ${err.message}`);
      return "Could not fetch plans.";
    }
  }
  
  // === 4. CAPTURE SMARTCARD ===
  static async handleCaptureSmartcard(userId, message, from) {
    const ctx = await redis.get(`bill_context:${from}`);
    if (!ctx) return null;

    const isSmartcard = /^\d{10,11}$/.test(message.trim());
    if (!isSmartcard) return null;

    const context = JSON.parse(ctx);
    await redis.setEx(
      `bill_smartcard:${from}`,
      3600,
      JSON.stringify({
        ...context,
        customerId: message.trim(),
      })
    );

    return `Smartcard: ${message}\nWhich bouquet? Reply with code (e.g., *GOHAN*).`;
  }

  // === 5. CAPTURE BOUQUET & CONFIRM ===
  static async handleConfirmBouquet(userId, message, from) {
    const ctx = await redis.get(`bill_smartcard:${from}`);
    if (!ctx) return null;

    const context = JSON.parse(ctx);
    const bouquetCode = message.trim().toUpperCase();

    try {
      const fieldsRes = await PsbVasService.getBillerFields(context.billerId);
      const bouquetField = fieldsRes.data.find((f) => f.isSelectData === "Y");
      const item = bouquetField.items.find((i) => i.itemId === bouquetCode);
      if (!item) return `Invalid code. Try again.`;

      await redis.setEx(
        `bill_confirm:${from}`,
        3600,
        JSON.stringify({
          ...context,
          itemId: item.itemId,
          amount: item.amount,
          itemName: item.itemName,
        })
      );

      return `Confirm:\n${item.itemName} (₦${item.amount})\nSmartcard: ${context.customerId}\n\nReply *yes* to pay.`;
    } catch (err) {
      return "Error validating bouquet.";
    }
  }

  //   subscribe Intent Service
  static async handleSubscribeIntent(userId, message, from) {
    if (!message.toLowerCase().includes("subscribe")) return null;

    const intent = message.toLowerCase();
    const targets = [
      { name: "GOTV", regex: /gotv|go tv/i, catId: "4" },
      { name: "DSTV", regex: /dstv|d stv/i, catId: "4" },
      { name: "STARTIMES", regex: /startimes|star times/i, catId: "4" },
    ];

    for (const t of targets) {
      if (t.regex.test(intent)) {
        try {
          const res = await PsbVasService.getCategoryBillers(t.catId); // CORRECT
          const billers = res.data || [];

          const list = billers.map((b) => `• ${b.name} (${b.id})`).join("\n");
          return `Subscribe to ${t.name}:\n${list}\n\nReply with biller (e.g., *CW-GOTV*) to continue.`;
        } catch (err) {
          logger.error(`[BILLS] Subscribe intent error: ${err.message}`);
          return "Could not fetch billers.";
        }
      }
    }
    return null;
  }

  // === 6. FINAL PAYMENT ===
  static async handlePayBill(userId, message, from) {
    if (!message.toLowerCase().includes("yes")) return null;

    const confirm = await redis.get(`bill_confirm:${from}`);
    if (!confirm) return "No payment to confirm.";

    const data = JSON.parse(confirm);
    const account = await prisma.account.findFirst({ where: { userId } });
    if (!account) return "No wallet found.";

    const payload = {
      userId,
      accountId: account.id,
      billerId: data.billerId,
      amount: data.amount,
      fields: {
        customerId: data.customerId,
        itemId: data.itemId,
        debitAccount: account.accountNumber, // ← REQUIRED
      },
    };

    try {
      const result = await PsbVasService.payBill(payload);
      await redis.del(`bill_context:${from}`);
      await redis.del(`bill_smartcard:${from}`);
      await redis.del(`bill_confirm:${from}`);

      return `${data.itemName} paid!\nSmartcard: ${data.customerId}\nRef: ${
        result.data?.transactionReference || "N/A"
      }`;
    } catch (err) {
      return `Payment failed: ${err.message}`;
    }
  }

  // === ELECTRICITY: CAPTURE METER ===
  static async handleElectricityMeter(userId, message, from) {
    const match = message.match(/^(\d{10,11})$/);
    if (!match) return null;

    const meterNo = match[1];

    await redis.setEx(`elec_meter:${from}`, 3600, meterNo);

    return `AEDC Prepaid\nMeter: ${meterNo}\n\nReply with amount (e.g., *N1000*)`;
  }

  // === ELECTRICITY: CAPTURE AMOUNT & PAY (WITH VALIDATION) ===
  static async handleElectricityAmount(userId, message, from) {
    const meter = await redis.get(`elec_meter:${from}`);
    if (!meter) return null;

    const match = message.match(/N?(\d{1,6})/i);
    if (!match) return null;

    const amount = match[1];
    const account = await prisma.account.findFirst({ where: { userId } });
    if (!account) return "No wallet.";

    try {
      const billersRes = await PsbVasService.getCategoryBillers("1");
      // Smart detection based on common keywords
      let billerId = "BP-ABUJA"; // default AEDC

      if (message.toLowerCase().includes("ikeja")) billerId = "BP-IKEJA";
      else if (message.toLowerCase().includes("eko")) billerId = "BP-EKO";
      else if (message.toLowerCase().includes("ibadan")) billerId = "BP-IBADAN";
      else if (message.toLowerCase().includes("enugu")) billerId = "BP-ENUGU";
      else if (message.toLowerCase().includes("kano")) billerId = "BP-KANO";
      else if (message.toLowerCase().includes("ph")) billerId = "BP-PH";
      else if (message.toLowerCase().includes("jos")) billerId = "BP-JOS";

      const biller =
        billersRes.data.find((b) => b.id === billerId) ||
        billersRes.data.find((b) => b.id.includes("ABUJA"));
      if (!biller) return "AEDC not available.";

      // VALIDATE meter → get real name
      const validateRes = await PsbVasService.validateBillerInputs({
        billerId: biller.id,
        fields: { meterNo: meter },
      });

      const customerName = validateRes.data?.customerName || "Customer";

      const payload = {
        userId,
        accountId: account.id,
        billerId: biller.id,
        amount,
        fields: {
          customerId: meter,
          meterNo: meter,
          debitAccount: account.accountNumber,
          customerName,
        },
      };

      const result = await PsbVasService.payBill(payload);
      await redis.del(`elec_meter:${from}`);

      return `AEDC ₦${amount} paid!\nName: ${customerName}\nMeter: ${meter}\nRef: ${
        result.data?.transactionReference || "N/A"
      }`;
    } catch (err) {
      return err.message.includes("validate")
        ? "Invalid meter. Try again."
        : `Payment failed: ${err.message}`;
    }
  }

  // === ELECTRICITY: DIRECT PAYMENT (meter + amount) ===
  static async handleElectricityPayment(userId, message, from) {
      const lower = message.toLowerCase();

  // Only allow direct meter+amount if user explicitly mentioned electricity
  const hasElectricityKeyword = /light|nepa|electricity|prepaid|meter|aedc|eko|ikeja/i.test(lower);
  if (!hasElectricityKeyword) return null;

  const match = message.match(/(\d{10,13})\s*[Nn]?(\d{3,})/);
  if (!match) return null;

  const meterNo = match[1].replace(/\D/g, '');
  const amount = match[2];

  if (meterNo.length < 10 || meterNo.length > 13) return null;

    // const match = message.match(/(\d{10,11})\s*N?(\d{1,6})/i);
    // if (!match) return null;

    // const meterNo = match[1];
    // const amount = match[2];

    try {
      const billersRes = await PsbVasService.getCategoryBillers("1");
      const biller = billersRes.data.find((b) => b.id === "BP-ABUJA");
      if (!biller) return "AEDC not available.";

      const account = await prisma.account.findFirst({ where: { userId } });
      if (!account) return "No wallet.";

      // Convert WhatsApp number (+2348012345678) → 08012345678
      let phone = from.replace(/^\+234/, "0"); // +234 → 0
      phone = phone.replace(/[^\d]/g, ""); // remove any non-digit
      if (phone.length === 10) phone = "0" + phone;
      if (!/^0\d{10}$/.test(phone)) {
        logger.warn(`[BILLS] Invalid phone for validation: ${from} → ${phone}`);
        phone = "08012345678"; // fallback or skip validation
      }

      const validateRes = await PsbVasService.validateBillerInputs({
        billerId: biller.id,
        customerId: meterNo,
        customerPhone: phone, // ← 08123456789
        amount: amount.toString(),
        itemId: "VT01", // ← Confirmed working
      });

      if (!validateRes.data?.customerName) {
        return "Meter not found. Please check the number.";
      }

      const customerName = validateRes.data.customerName;

      const payload = {
        userId,
        accountId: account.id,
        billerId: biller.id,
        amount: amount.toString(),
        fields: {
          customerId: meterNo,
          meterNo,
          debitAccount: account.accountNumber,
          customerName,
        },
      };

      const result = await PsbVasService.payBill(payload);
      return `AEDC ₦${amount} paid!\nName: ${customerName}\nMeter: ${meterNo}\nRef: ${
        result.data?.transactionReference || "N/A"
      }`;
    } catch (err) {
      logger.error(`[ELECTRICITY] Validate/Pay failed`, { err, from, message });
      return "Payment failed. Please try again later.";
    }
  }

  // === PROCESS INTENT ===
  static async process(userId, message, from) {
    // BLOCK BILLS IF USER IS IN AIRTIME OR DATA FLOW
    const vasContext = await redis.get(`vas:${from}`);
    if (vasContext) {
      try {
        const ctx = JSON.parse(vasContext);
        if (ctx.flow === "airtime" || ctx.flow === "data") {
          return null; // LET VAS HANDLE IT — DO NOT INTERFERE
        }
      } catch (err) {
        // ignore
      }
    }

    // BLOCK IF USER IS IN ANY ONGOING FLOW (optional but smart)
    const ongoingFlow = await redis.get(`flow:${from}`);
    if (ongoingFlow) return null;

    if (
      message.toLowerCase().includes("save") ||
      message.toLowerCase().includes("beneficiar")
    ) {
      return null;
    }
    if (await redis.get(`flow:${from}`)) return null;

    // INSTANT SHORTCUTS — NIGERIANS LOVE THIS
    if (
      message.toLowerCase().includes("light") ||
      message.toLowerCase().includes("nepa")
    ) {
      return "Pay Electricity Bill\n\nReply with:\n• Meter number + amount (e.g. *12345678901 N5000*)\n• Or just meter (e.g. *12345678901*) and I’ll ask amount";
    }

    const handlers = [
      this.handleListCategories,
      this.handleSubscribeIntent,
      this.handleListBillers,
      (u, m, f) => this.handleListBouquets(u, m, f),
      this.handleElectricityMeter, // ← NEW
      this.handleElectricityAmount, // ← NEW (ONLY ONE)
      this.handleElectricityPayment, // ← Keep for "123 N1000"
      (u, m, f) => this.handleCaptureSmartcard(u, m, f),
      (u, m, f) => this.handleConfirmBouquet(u, m, f),
      (u, m, f) => this.handlePayBill(u, m, f),
    ];

    for (const h of handlers) {
      const r =
        h.length === 3
          ? await h(userId, message, from)
          : await h(userId, message);
      if (r) return r;
    }
    return null;
  }
}

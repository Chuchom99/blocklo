// services/electricity.bill.service.js
import PsbVasService from "../services/psb.vas.services.js";
import redis from "../config/redis.js";
import logger from "../config/logger.js";
import prisma from "../config/prisma.js";
import { generateVasReceipt } from "../utils/pdf.vas.utils.js";

const ELECTRICITY_CATEGORY_ID = "1";

export class ElectricityBillService {
  static async process(userId, message, from) {
    const lower = message.toLowerCase().trim();
    const cacheKey = `bill_electricity:${from}`;

    const keywords = [
      "light",
      "electricity",
      "nepa",
      "phcn",
      "disco",
      "prepaid",
      "meter",
      "ikeja",
      "eko",
      "aedc",
    ];
    if (!keywords.some((k) => lower.includes(k))) return null;

    // Check existing flow
    const existing = await redis.get(cacheKey);
    if (existing) {
      const flow = JSON.parse(existing);
      return await this.handleFlow(userId, from, message, flow);
    }

    // New flow: Show discos
    await redis.setEx(cacheKey, 3600, JSON.stringify({ step: "select_disco" }));
    return await this.showDiscos(userId, from);
  }

  static async showDiscos(userId, from) {
    try {
      const response = await PsbVasService.getCategoryBillers(
        ELECTRICITY_CATEGORY_ID,
      );
      const billers = response.data || [];

      // Sort popular ones first
      const popularIds = [
        "BP-IKEJA",
        "BP-EKO",
        "BP-ABUJA",
        "BP-ENUGU",
        "BP-PH",
        "BP-KADUNA",
      ];
      const popular = billers
        .filter((b) => popularIds.includes(b.id))
        .sort((a, b) => popularIds.indexOf(a.id) - popularIds.indexOf(b.id));

      const others = billers.filter((b) => !popularIds.includes(b.id));

      let text = "*Select your Electricity Provider*\n\n";

      // Show popular ones with numbers
      popular.forEach((b, i) => {
        text += `${i + 1}. ${b.name}\n`;
      });

      if (others.length > 0) {
        text += `\n...and ${others.length} more (e.g., KEDCO, JEDC, YEDC)\n`;
        text += "Reply with name if not listed";
      }

      // CREATE BUTTONS (max 3 on WhatsApp)
      const buttons = popular.slice(0, 3).map((b) => ({
        type: "reply",
        reply: {
          id: `DISCO_${b.id}`,
          title: b.name.length > 20 ? b.name.substring(0, 17) + "..." : b.name,
        },
      }));

      // Cache full list for text fallback
      await redis.setEx(`discos:${from}`, 3600, JSON.stringify(billers));

      return {
        type: "interactive",
        payload: {
          type: "button",
          body: { text },
          action: { buttons }, // ← NOW HAS BUTTONS!
        },
      };
    } catch (error) {
      logger.error(`[ELECTRICITY] Failed to load discos: ${error.message}`);
      return "Sorry, electricity providers are temporarily unavailable. Try again in a few minutes.";
    }
  }

  static async handleFlow(userId, from, message, flow) {
    const cacheKey = `bill_electricity:${from}`;
    const discos = JSON.parse((await redis.get(`discos:${from}`)) || "[]");

    if (flow.step === "select_disco") {
      let selectedBiller = null;

      // Button click
      if (message.startsWith("DISCO_")) {
        const id = message.replace("DISCO_", "");
        selectedBiller = discos.find((b) => b.id === id);
      } else {
        // Text match
        selectedBiller = discos.find(
          (b) =>
            b.name.toLowerCase().includes(message.toLowerCase()) ||
            b.id.toLowerCase().includes(message.toLowerCase()),
        );
      }

      if (!selectedBiller) {
        return "I don't recognize that provider. Please select from the list.";
      }

      await redis.setEx(
        cacheKey,
        3600,
        JSON.stringify({
          step: "enter_meter",
          billerId: selectedBiller.id,
          billerName: selectedBiller.name,
        }),
      );

      return `You've selected *${selectedBiller.name}*\n\nPlease send your meter number (e.g., 12345678901)`;
    }

    if (flow.step === "enter_meter") {
      const meter = message.trim();
      if (!/^\d{10,15}$/.test(meter)) {
        return "Invalid meter number. Please send a valid number (10–15 digits).";
      }

      await redis.setEx(
        cacheKey,
        3600,
        JSON.stringify({
          ...flow,
          step: "enter_amount",
          meterNumber: meter,
        }),
      );

      return `Meter: *${meter}*\n\nHow much do you want to buy? (e.g., ₦5000)`;
    }

    if (flow.step === "enter_amount") {
      const amount = parseFloat(message.replace(/[^\d.]/g, ""));
      if (isNaN(amount) || amount < 1000) {
        return "Minimum electricity purchase is ₦1,000. Please enter a valid amount.";
      }

      return await this.confirmAndPay(userId, from, { ...flow, amount });
    }

    return "Session expired. Say *light* or *electricity* to start again.";
  }

  static async confirmAndPay(userId, from, flow) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { accounts: true },
    });
    if (!user?.accounts?.[0])
      return "Account not found. Say *balance* to refresh.";

    const account = user.accounts[0];

    try {
      // Validate meter first
      const validatePayload = {
        billerId: flow.billerId,
        customerId: flow.meterNumber,
        customerPhone: user.phone?.replace(/^0/, "234") || "2348000000000",
        amount: String(flow.amount),
      };

      const validateResponse =
        await PsbVasService.validatePayment(validatePayload);

      if (!validateResponse.data?.customerName) {
        return `Meter ${flow.meterNumber} not found or invalid. Please check and try again.`;
      }

      const customerName = validateResponse.data.customerName || "Customer";

      // Pay
      const payPayload = {
        billerId: flow.billerId,
        amount: String(flow.amount),
        accountNumber: account.accountNumber,
        transactionReference: `ELEC${Date.now()}${Math.random()
          .toString(36)
          .substr(2, 4)
          .toUpperCase()}`,
        customerId: flow.meterNumber,
        customerPhone: validatePayload.customerPhone,
      };

      const response = await PsbVasService.payBill({
        userId,
        accountId: account.id,
        billerId: flow.billerId,
        amount: flow.amount,
        fields: payPayload,
      });

      await redis.del(`bill_electricity:${from}`);
      await redis.del(`discos:${from}`);

      const token =
        response.data?.token || response.data?.accessToken || "Not provided";

      const receiptPath = await generateVasReceipt({
        ref: response.ref || payPayload.transactionReference,
        service: "Electricity Payment",
        amount: flow.amount,
        phoneNumber: user.phone || "N/A",
        networkEmoji: "Lightning",
        networkName: flow.billerName,
        accountNumber: account.accountNumber,
        customerName: `${user.firstName} ${user.lastName || ""}`.trim(),
        meterNumber: flow.meterNumber,
        disco: flow.billerName,
        customerOnMeter: customerName,
        token: token,
      });

      return {
        text:
          `Electricity Payment Successful!\n\n` +
          `Disco: ${flow.billerName}\n` +
          `Meter: ${flow.meterNumber}\n` +
          `Name: ${customerName}\n` +
          `Amount: ₦${flow.amount.toLocaleString()}\n` +
          `Ref: ${response.ref || "N/A"}\n\n` +
          `TOKEN: ||| ${token} |||\n\n` +
          `Receipt attached`,
        document: {
          url: `http://localhost:5000${receiptPath}`,
          filename: `electricity_${flow.meterNumber}.pdf`,
        },
      };
    } catch (error) {
      logger.error(`[ELECTRICITY] Payment failed: ${error.message}`);
      return `Payment failed: ${error.message}`;
    }
  }
}

export default ElectricityBillService;

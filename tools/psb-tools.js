import {
  handleBalance,
  handleTransfer,
  handleTransactionHistory,
} from "../services/ai.handler.js";
import { v4 as uuidv4 } from "uuid";
import WhatsAppService from "../services/whatsapp.services.js";
import prisma from "../config/prisma.js";

export const psbFunctions = [
  {
    name: "get_balance",
    description: "Fetch user's current wallet balance",
    parameters: { type: "object", properties: {}, required: [] },
    handler: async (args, context) => {
      return await handleBalance(context.userId);
    },
  },
  {
    name: "transfer_money",
    description:
      "Transfer money from user wallet. Amount in NGN. For other banks, include bank_code.",
    parameters: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Amount to transfer" },
        destination_account: { type: "string", description: "Recipient account number" },
        bank_code: { type: "string", description: "Optional: 3-digit bank code (e.g., 011 for GTB)" },
        narration: { type: "string", description: "Optional memo" },
      },
      required: ["amount", "destination_account"],
    },
    handler: async (args, context) => {
      const message = `transfer ${args.amount} to ${args.destination_account} ${
        args.bank_code ? `bank ${args.bank_code}` : "within 9psb"
      } ${args.narration || ""}`;
      return await handleTransfer(context.from, message, context.userId);
    },
  },
  {
    name: "get_transaction_history",
    description: "Get last 5 transactions",
    parameters: { type: "object", properties: {}, required: [] },
    handler: async (args, context) => {
      return await handleTransactionHistory(context.userId);
    },
  },
  {
    name: "start_registration",
    description: "Trigger WhatsApp registration flow",
    parameters: { type: "object", properties: {}, required: [] },
    handler: async (args, context) => {
      const flowId = process.env.WHATSAPP_REGISTRATION_FLOW_ID;
      if (!flowId) return "Registration unavailable.";
      const token = uuidv4();
      await WhatsAppService.sendRegistrationFlow(context.from, flowId, token);
      return "Please complete the form sent to your WhatsApp to register.";
    },
  },

{
  name: "list_beneficiaries",
  description: "List all saved beneficiaries for the user",
  parameters: { type: "object", properties: {}, required: [] },
  handler: async (args, { from }) => {
    const normalized = from.replace(/[^\d]/g, "").replace(/^234/, "234");

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { whatsappId: normalized },
          { phone: normalized.replace(/^234/, "0") },
        ],
      },
      include: {
        beneficiaries: {
          orderBy: { createdAt: "desc" },
          select: {
            alias: true,
            accountNo: true,
            bankName: true,
            accountName: true,
          },
        },
      },
    });

    if (!user || user.beneficiaries.length === 0) {
      return "You have no saved beneficiaries yet.\n\nTo save one, say:\n*send 5000 to 1234567890 GTBank*";
    }

    const list = user.beneficiaries
      .map((b, i) => 
        `${i + 1}. *${b.alias}*\n   ${b.accountName}\n   ${b.accountNo} • ${b.bankName}`
      )
      .join("\n\n");

    return `Your Saved Beneficiaries:\n\n${list}\n\nReply with alias to send money fast!\n(e.g. *send 2000 to mom*)`;
  },
},
//  delete beneficiary
{
  name: "delete_beneficiary",
  description: "Delete a saved beneficiary by alias",
  parameters: {
    type: "object",
    properties: { alias: { type: "string" } },
    required: ["alias"],
  },
  handler: async ({ alias }, { from }) => {
    const result = await prisma.beneficiary.deleteMany({
      where: {
        user: { whatsappId: from.replace(/[^\d]/g, "").replace(/^234/, "234") },
        alias: { equals: alias, mode: "insensitive" },
      },
    });

    return result.count > 0
      ? `${alias} has been removed from your beneficiaries.`
      : `No beneficiary found with alias "${alias}"`;
  },
}
];
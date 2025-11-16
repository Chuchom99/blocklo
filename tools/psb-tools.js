import {
  handleBalance,
  handleTransfer,
  handleKycStatus,
  handleTransactionHistory,
} from "../services/ai.handler.js";
import { v4 as uuidv4 } from "uuid";
import WhatsAppService from "../services/whatsapp.services.js";

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
    name: "get_kyc_status",
    description: "Check user's KYC verification status",
    parameters: { type: "object", properties: {}, required: [] },
    handler: async (args, context) => {
      return await handleKycStatus(context.userId);
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
];
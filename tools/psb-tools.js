import PsbService from "../services/psb.service.js";
import WhatsAppService from "../services/whatsapp.services.js";
import { BeneficiaryService } from "../services/beneficiary.service.js";
import TransferIntentService from "../intent/transfer.intent.js";
import TransactionHistoryService from "../intent/transaction.history.intent.js";
import { BeneficiaryIntentService } from "../intent/beneficiary.intent.js";
import { VasIntentService } from "../intent/vas.intent.js";
import { naira, parseAmount } from "../utils/format.js";
import { isNigerianMobile, toLocalPhone } from "../utils/phone.js";

// LLM tools. Identity always comes from ctx (the verified WhatsApp sender), never
// from tool arguments. Money tools only *draft* a payment: the user must still
// confirm it with their PIN in the secure Flow, so a confused or manipulated model
// cannot move money on its own.

const CONFIRMATION_SENT =
  "A secure confirmation form has been sent to the user. Tell them to review it and enter their PIN there. The payment is NOT complete yet; do not say it is.";

// Turn an intent handler's reply into a tool result for the model.
async function deliver(ctx, reply) {
  if (!reply) return "That request couldn't be handled.";
  if (reply.sent) return CONFIRMATION_SENT;
  if (typeof reply === "string") return reply;
  await WhatsAppService.sendReply(ctx.from, reply);
  return "The options were sent to the user as a separate message. Ask them to choose from it.";
}

export const psbFunctions = [
  {
    name: "get_balance",
    description: "Get the user's current wallet balance.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: async (_args, ctx) => {
      const balance = await PsbService.getBalance(ctx.account.accountNumber);
      return balance === null ? "Balance is temporarily unavailable." : `Balance: ${naira(balance)}`;
    },
  },
  {
    name: "get_transaction_history",
    description: "Get the user's 10 most recent transactions.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: async (_args, ctx) => (await TransactionHistoryService.page(ctx, 1, false)).text ?? "No transactions.",
  },
  {
    name: "list_beneficiaries",
    description: "List the user's saved beneficiaries.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: async (_args, ctx) => BeneficiaryService.list(ctx.user.id),
  },
  {
    name: "start_transfer",
    description:
      "Start a bank transfer. This only prepares it: the user confirms with their PIN in a secure form. Use either destination_account (10 digits) or beneficiary_alias.",
    parameters: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Amount in naira" },
        destination_account: { type: "string", description: "10-digit account number" },
        bank_name: { type: "string", description: "Bank name, e.g. GTBank, Access, 9PSB" },
        beneficiary_alias: { type: "string", description: "A saved beneficiary's name" },
      },
      required: ["amount"],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const amount = parseAmount(args.amount);
      if (!amount) return "Ask the user for a valid amount.";
      if (args.beneficiary_alias) {
        const b = await BeneficiaryService.findByAlias(ctx.user.id, args.beneficiary_alias);
        if (!b) return `There is no saved beneficiary called "${args.beneficiary_alias}".`;
        return deliver(ctx, await TransferIntentService.confirm(ctx, {
          amount,
          accountNumber: b.accountNo,
          bank: { code: b.bankCode, name: b.bankName },
        }));
      }
      if (!/^\d{10}$/.test(String(args.destination_account || ""))) return "Ask the user for the 10-digit account number.";
      return deliver(ctx, await TransferIntentService.withBank(ctx, {
        amount,
        accountNumber: args.destination_account,
        bankInput: args.bank_name,
      }));
    },
  },
  {
    name: "remove_beneficiary",
    description: "Ask the user to confirm removing a saved beneficiary.",
    parameters: {
      type: "object",
      properties: { alias: { type: "string" } },
      required: ["alias"],
      additionalProperties: false,
    },
    handler: async ({ alias }, ctx) => deliver(ctx, await BeneficiaryIntentService.requestDelete(ctx, alias)),
  },
];

export const psbVasFunctions = [
  {
    name: "start_airtime_purchase",
    description: "Start an airtime purchase. The user confirms with their PIN in a secure form.",
    parameters: {
      type: "object",
      properties: {
        phone_number: { type: "string", description: "Nigerian number, e.g. 08012345678" },
        amount: { type: "number", description: "Amount in naira" },
      },
      required: ["phone_number", "amount"],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const amount = parseAmount(args.amount);
      const phone = toLocalPhone(args.phone_number);
      if (!amount) return "Ask the user for a valid amount.";
      if (!isNigerianMobile(phone)) return "Ask the user for a valid Nigerian phone number.";
      return deliver(ctx, await VasIntentService.confirmAirtime(ctx, phone, amount));
    },
  },
  {
    name: "show_data_plans",
    description: "Show available data plans for a phone number so the user can pick one.",
    parameters: {
      type: "object",
      properties: { phone_number: { type: "string" } },
      required: ["phone_number"],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const phone = toLocalPhone(args.phone_number);
      if (!isNigerianMobile(phone)) return "Ask the user for a valid Nigerian phone number.";
      return deliver(ctx, await VasIntentService.showDataPlans(ctx, phone));
    },
  },
];

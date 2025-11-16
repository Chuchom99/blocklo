
import {
  handleBuyAirtime,
  handleBuyData,
  handleListDataPlans,
  handlePayBill,
} from "../services/ai.vas.handler.js";

export const psbVasFunctions = [
  {
    name: "buy_airtime",
    description: "Buy airtime for any Nigerian number from user's wallet",
    parameters: {
      type: "object",
      properties: {
        phoneNumber: { type: "string", description: "Recipient phone number" },
        amount: { type: "number", description: "Amount in NGN (min 100)" },
      },
      required: ["phoneNumber", "amount"],
    },
    handler: async (args, context) => {
      return await handleBuyAirtime(context.userId, args);
    },
  },
  {
    name: "buy_data",
    description: "Buy data bundle using productId",
    parameters: {
      type: "object",
      properties: {
        phoneNumber: { type: "string" },
        productId: { type: "string", description: "e.g., MTN_1GB" },
      },
      required: ["phoneNumber", "productId"],
    },
    handler: async (args, context) => {
      return await handleBuyData(context.userId, args);
    },
  },
  {
    name: "list_data_plans",
    description: "List available data plans for a phone number",
    parameters: {
      type: "object",
      properties: {
        phoneNumber: { type: "string" },
      },
      required: ["phoneNumber"],
    },
    handler: async (args, context) => {
      return await handleListDataPlans(context.userId, args);
    },
  },
  {
    name: "pay_bill",
    description: "Pay electricity, DSTV, etc. using billerId and fields",
    parameters: {
      type: "object",
      properties: {
        billerId: { type: "string" },
        amount: { type: "number" },
        fields: { type: "object", description: "e.g., { meterNo: '123456' }" },
      },
      required: ["billerId", "amount", "fields"],
    },
    handler: async (args, context) => {
      return await handlePayBill(context.userId, args);
    },
  },
];
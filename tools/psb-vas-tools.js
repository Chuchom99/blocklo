
import {
  handleBuyAirtime,
  handleBuyData,
  handleListDataPlans,
  handlePayBill,
} from "../services/ai.vas.handler.js";

export const psbVasFunctions = [
  {
    name: "buy_airtime",
    description: "Buy airtime for any Nigerian phone number using the user's wallet balance",
    parameters: {
      type: "object",
      properties: {
        phoneNumber: {
          type: "string",
          description: "The Nigerian phone number to recharge (e.g. 08012345678 or +2348012345678)"
        },
        amount: {
          type: "number",
          description: "Amount in Naira. Minimum 100, maximum 50000"
        }
      },
      required: ["phoneNumber", "amount"],
      additionalProperties: false   // ← THIS IS CRUCIAL
    },
    handler: async (args, context) => {
      // Safety net — if args is missing, fail gracefully
      if (!args || !args.phoneNumber || !args.amount) {
        return "Please provide both phone number and amount. Example: Buy 500 airtime for 08030908709";
      }
      return await handleBuyAirtime(context, args);
    },
  },

  {
    name: "buy_data",
    description: "Buy mobile data bundle for a Nigerian number",
    parameters: {
      type: "object",
      properties: {
        phoneNumber: { type: "string", description: "Recipient phone number" },
        productId: { type: "string", description: "Exact productId from list_data_plans (e.g. MTN_1GB_DAILY)" }
      },
      required: ["phoneNumber", "productId"],
      additionalProperties: false
    },
    handler: async (args, context) => {
      if (!args?.phoneNumber || !args?.productId) {
        return "Please select a valid data plan first using 'show data plans'";
      }
      return await handleBuyData(context, args);
    },
  },

  {
    name: "list_data_plans",
    description: "Show available data bundles for a phone number",
    parameters: {
      type: "object",
      properties: {
        phoneNumber: { type: "string" }
      },
      required: ["phoneNumber"],
      additionalProperties: false
    },
    handler: async (args, context) => {
      if (!args?.phoneNumber) {
        return "Please provide a phone number to see data plans.";
      }
      return await handleListDataPlans(context, args);
    },
  },

  {
    name: "pay_bill",
    description: "Pay electricity bill, DSTV, GoTV, Startimes, etc.",
    parameters: {
      type: "object",
      properties: {
        billerId: { type: "string" },
        amount: { type: "number" },
        fields: { 
          type: "object", 
          description: "Key-value pairs required by the biller (e.g. { meterNumber: '1234567890' })"
        }
      },
      required: ["billerId", "amount", "fields"],
      additionalProperties: false
    },
    handler: async (args, context) => {
      if (!args?.billerId || !args?.amount || !args?.fields) {
        return "Incomplete bill information. Please try again.";
      }
      return await handlePayBill(context, args);
    },
  }
];
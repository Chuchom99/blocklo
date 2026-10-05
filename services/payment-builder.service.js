import PsbVasService from "./psb.vas.services.js";
import { BankService } from "./bank.service.js";
import { resolveAccountName } from "./beneficiary.service.js";
import { MIN_ELECTRICITY_AMOUNT } from "../utils/constant.js";
import { badRequest, tooMany } from "../utils/errors.js";
import { maskAccount, naira } from "../utils/format.js";
import { isNigerianMobile, toLocalPhone } from "../utils/phone.js";
import { hit } from "../utils/rateLimit.js";

// Turn a payment request (from chat or the REST API) into a fully server-resolved
// { kind, amount, payload, summary }. Everything shown in the confirmation —
// recipient name, price, meter owner — comes from 9PSB here, never from the client.

export const BILL_CATEGORIES = { electricity: "1", tv: "4" };

export async function buildTransfer(ctx, { amount, accountNumber, bank }) {
  if (!/^\d{10}$/.test(String(accountNumber))) throw badRequest("Account number must be 10 digits.", "BAD_ACCOUNT");
  if (accountNumber === ctx.account.accountNumber) throw badRequest("You can't send money to your own account.", "SELF_TRANSFER");

  const resolvedBank = bank.name ? bank : await BankService.findCode(bank.code);
  if (!resolvedBank) throw badRequest("Unknown bank.", "BAD_BANK");

  // Name enquiry reveals account holders' names, so cap how often one user can run it.
  if (!(await hit(`enquiry:${ctx.user.id}`, 20, 3600)).allowed) {
    throw tooMany("You've checked a lot of accounts in a short time. Please try again later.");
  }
  const accountName = await resolveAccountName(accountNumber, resolvedBank.code);
  if (!accountName) {
    throw badRequest(`Couldn't verify account ${maskAccount(accountNumber)} at ${resolvedBank.name}. Please check the details.`, "NAME_ENQUIRY_FAILED");
  }

  return {
    kind: "TRANSFER",
    amount,
    payload: {
      accountNumber,
      bankCode: resolvedBank.code,
      bankName: resolvedBank.name,
      accountName,
      narration: `Transfer to ${accountName}`.slice(0, 100),
    },
    summary: `Send ${naira(amount)} to ${accountName}\n${resolvedBank.name} • ${maskAccount(accountNumber)}`,
  };
}

export async function buildAirtime(_ctx, { phoneNumber, amount }) {
  const phone = toLocalPhone(phoneNumber);
  if (!isNigerianMobile(phone)) throw badRequest("Please use a valid Nigerian phone number.", "BAD_PHONE");
  const { name: network } = await PsbVasService.detectNetwork(phone);
  if (network === "UNKNOWN") throw badRequest(`Couldn't detect the network for ${phone}.`, "UNKNOWN_NETWORK");
  return {
    kind: "AIRTIME",
    amount,
    payload: { phoneNumber: phone, network },
    summary: `${naira(amount)} ${network} airtime\nTo ${phone}`,
  };
}

export async function buildData(_ctx, { phoneNumber, productId }) {
  const phone = toLocalPhone(phoneNumber);
  if (!isNigerianMobile(phone)) throw badRequest("Please use a valid Nigerian phone number.", "BAD_PHONE");
  const [plans, { name: network }] = await Promise.all([
    PsbVasService.getDataPlans(phone),
    PsbVasService.detectNetwork(phone),
  ]);
  const plan = plans.find((p) => p.productId === String(productId));
  if (!plan) throw badRequest("That data plan isn't available.", "BAD_PLAN");
  return {
    kind: "DATA",
    amount: plan.price,
    payload: { phoneNumber: phone, network, productId: plan.productId, planName: String(plan.size) },
    summary: `${network} ${plan.size}${plan.validity ? ` (${plan.validity})` : ""} — ${naira(plan.price)}\nTo ${phone}`,
  };
}

// type: "electricity" (amount chosen by the user) or "tv" (amount comes from the bouquet).
export async function buildBill(ctx, { type, billerId, customerId, amount, itemId }) {
  const categoryId = BILL_CATEGORIES[type];
  if (!categoryId) throw badRequest("Unsupported bill type.", "BAD_BILL_TYPE");

  const billers = (await PsbVasService.getCategoryBillers(categoryId))?.data || [];
  const biller = billers.find((b) => b.id === billerId);
  if (!biller) throw badRequest("Unknown biller.", "BAD_BILLER");

  let price = amount;
  let itemName;
  if (type === "tv") {
    const fields = await PsbVasService.getBillerFields(billerId);
    const item = (fields?.data?.find((f) => f.fieldName === "itemId")?.items || []).find((i) => String(i.itemId) === String(itemId));
    if (!item) throw badRequest("That bouquet isn't available.", "BAD_ITEM");
    price = Number.parseFloat(item.amount);
    itemName = item.itemName;
  } else if (!(price >= MIN_ELECTRICITY_AMOUNT)) {
    throw badRequest(`Minimum electricity purchase is ${naira(MIN_ELECTRICITY_AMOUNT)}.`, "AMOUNT_TOO_SMALL");
  }

  const customerPhone = ctx.user.phone?.replace(/^0/, "234");
  const validation = await PsbVasService.validatePayment({
    billerId,
    customerId,
    customerPhone,
    amount: String(price),
    ...(itemId && { itemId }),
  });
  const customerName = validation?.data?.customerName;
  if (!customerName) throw badRequest(`${customerId} could not be verified with ${biller.name}.`, "CUSTOMER_NOT_FOUND");

  const fields = type === "tv" ? { customerId, itemId: String(itemId) } : { customerId, customerPhone };
  const label = type === "tv" ? `${biller.name} — ${itemName}\nSmart card ${customerId}` : `${biller.name} electricity\nMeter ${customerId}`;

  return {
    kind: "BILL",
    amount: price,
    payload: { billerId, billerName: biller.name, customerId, customerName, fields },
    summary: `${label} • ${customerName}\n${naira(price)}`,
  };
}

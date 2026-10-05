import { v4 as uuidv4 } from "uuid";
import config from "../config/env.js";
import prisma from "../config/prisma.js";
import logger from "../config/logger.js";
import { paymentsQueue } from "../config/queue.js";
import PsbService, { OUTCOME } from "./psb.service.js";
import PsbVasService from "./psb.vas.services.js";
import WhatsAppService from "./whatsapp.services.js";
import * as ledger from "./ledger.service.js";
import { verifyPin } from "./pin.service.js";
import { issuePaymentToken } from "./flow-token.service.js";
import { audit } from "./audit.service.js";
import { AppError, badRequest } from "../utils/errors.js";
import { MIN_AMOUNT, PAYMENT_INTENT_TTL_MS, TIER_LIMITS } from "../utils/constant.js";
import { naira } from "../utils/format.js";
import { renderReceipt } from "../utils/receipt.pdf.js";

// The only code path allowed to move customer money.
//
//   draft()     – validate, check limits, store a DRAFT intent, ask the user to confirm
//   authorize() – check the PIN (with lockout), atomically DRAFT -> AUTHORIZED, enqueue
//   execute()   – (worker) AUTHORIZED -> EXECUTING, write PENDING ledger row, call 9PSB once,
//                 settle the row from the real answer, notify the user
//
// Nothing the user types in chat, and nothing the LLM says, can skip authorize().

export const KINDS = ["TRANSFER", "AIRTIME", "DATA", "BILL"];

const newReference = () => uuidv4().replace(/-/g, "").slice(0, 18);

export async function checkLimits(user, amount) {
  const tier = TIER_LIMITS[user.kycLevel] || TIER_LIMITS[1];
  if (amount > tier.perTransaction) {
    throw badRequest(`Your Tier ${user.kycLevel} limit is ${naira(tier.perTransaction)} per transaction.`, "LIMIT_PER_TX");
  }
  const spent = await ledger.spentToday(user.id);
  if (spent + amount > tier.daily) {
    throw badRequest(
      `This would exceed your daily limit of ${naira(tier.daily)}. You can still send ${naira(Math.max(tier.daily - spent, 0))} today.`,
      "LIMIT_DAILY",
    );
  }
}

// payload by kind:
//   TRANSFER: { accountNumber, bankCode, bankName, accountName, narration }
//   AIRTIME:  { phoneNumber, network }
//   DATA:     { phoneNumber, network, productId, planName }
//   BILL:     { billerId, billerName, customerId, customerName, fields }
export async function draft({ user, account, kind, amount, payload, summary, channel = "whatsapp" }) {
  if (!config.paymentsEnabled) throw new AppError(503, "Payments are temporarily unavailable. Please try again later.", "PAYMENTS_DISABLED");
  if (!KINDS.includes(kind)) throw new Error(`Unsupported payment kind ${kind}`);
  if (user.status !== "ACTIVE") throw badRequest("Your account isn't active for payments.", "ACCOUNT_INACTIVE");
  if (!account || account.userId !== user.id) throw badRequest("No wallet found for your account.", "NO_ACCOUNT");
  if (!user.transactionPin) throw badRequest("Please set a transaction PIN first.", "NO_PIN");

  const value = Number(amount);
  const hasAtMostTwoDecimals = Math.abs(Math.round(value * 100) - value * 100) < 1e-6;
  if (!Number.isFinite(value) || value <= 0 || !hasAtMostTwoDecimals) throw badRequest("Invalid amount.", "BAD_AMOUNT");
  if (value < MIN_AMOUNT[kind]) throw badRequest(`Minimum amount is ${naira(MIN_AMOUNT[kind])}.`, "AMOUNT_TOO_SMALL");

  await checkLimits(user, value);

  const balance = await PsbService.getBalance(account.accountNumber);
  if (balance !== null && balance < value) {
    throw badRequest(`Insufficient funds. Your balance is ${naira(balance)}.`, "INSUFFICIENT_FUNDS");
  }

  // One open request at a time keeps confirmations unambiguous.
  await prisma.paymentIntent.updateMany({ where: { userId: user.id, status: "DRAFT" }, data: { status: "CANCELLED" } });

  return prisma.paymentIntent.create({
    data: {
      userId: user.id,
      accountId: account.id,
      kind,
      amount: value,
      payload,
      summary,
      channel,
      idempotencyKey: newReference(),
      expiresAt: new Date(Date.now() + PAYMENT_INTENT_TTL_MS),
    },
  });
}

// WhatsApp: send the secure Flow where the user reviews the summary and enters their PIN.
export async function requestWhatsAppConfirmation(intent, user) {
  const flowId = config.whatsapp.paymentFlowId;
  if (!flowId) throw new AppError(503, "Payment confirmation is not configured.", "NO_PAYMENT_FLOW");
  await WhatsAppService.sendFlow(user.whatsappId, {
    flowId,
    flowToken: issuePaymentToken(intent.id, user.whatsappId),
    header: "Confirm payment",
    body: `${intent.summary}\n\nTap below to review and enter your PIN. This request expires in 5 minutes.`,
    cta: "Review & pay",
  });
}

// Build + draft + send the PIN confirmation, for chat intents and LLM tools.
// `build` is a payment-builder call. Returns { sent: true } or a message for the user.
export async function draftAndConfirm(ctx, build) {
  try {
    const { kind, amount, payload, summary } = await build();
    const intent = await draft({ user: ctx.user, account: ctx.account, kind, amount, payload, summary });
    await requestWhatsAppConfirmation(intent, ctx.user);
    return { sent: true };
  } catch (err) {
    if (err.expose) return err.message;
    logger.error(`[INTENT] draft failed: ${err.message}`);
    return "Sorry, I couldn't set up that payment. Please try again.";
  }
}

// Returns { ok: true, intent } or { ok: false, reason, remaining?, lockedUntil? }.
export async function authorize({ intentId, userId, pin }) {
  const intent = await prisma.paymentIntent.findUnique({ where: { id: intentId } });
  if (!intent || intent.userId !== userId) return { ok: false, reason: "NOT_FOUND" };
  if (intent.status !== "DRAFT") return { ok: false, reason: "ALREADY_USED" };
  if (intent.expiresAt <= new Date()) {
    await prisma.paymentIntent.updateMany({ where: { id: intentId, status: "DRAFT" }, data: { status: "EXPIRED" } });
    return { ok: false, reason: "EXPIRED" };
  }

  const pinResult = await verifyPin(userId, pin);
  if (!pinResult.ok) return pinResult;

  // Atomic claim: if two authorizations race, exactly one wins.
  const { count } = await prisma.paymentIntent.updateMany({
    where: { id: intentId, userId, status: "DRAFT", expiresAt: { gt: new Date() } },
    data: { status: "AUTHORIZED", authorizedAt: new Date() },
  });
  if (count === 0) return { ok: false, reason: "ALREADY_USED" };

  await enqueueExecution(intentId);
  await audit(userId, "payment.authorized", { target: intentId, metadata: { kind: intent.kind, amount: Number(intent.amount) } });
  return { ok: true, intent };
}

export async function cancel(intentId, userId) {
  const { count } = await prisma.paymentIntent.updateMany({
    where: { id: intentId, userId, status: "DRAFT" },
    data: { status: "CANCELLED" },
  });
  return count > 0;
}

const enqueueExecution = (intentId) =>
  // jobId = intentId, attempts = 1: the queue will never run a payment twice.
  paymentsQueue.add("execute", { intentId }, { jobId: intentId, attempts: 1, removeOnComplete: 1000, removeOnFail: 5000 });

// Periodic sweep: expire unconfirmed drafts, and re-queue authorized intents whose
// job was never enqueued (e.g. Redis blipped right after the PIN was accepted).
// Re-queuing is safe: execute() only runs an intent that is still AUTHORIZED.
export async function expireStale() {
  const { count } = await prisma.paymentIntent.updateMany({
    where: { status: "DRAFT", expiresAt: { lte: new Date() } },
    data: { status: "EXPIRED" },
  });
  const stuck = await prisma.paymentIntent.findMany({
    where: { status: "AUTHORIZED", authorizedAt: { lt: new Date(Date.now() - 2 * 60_000) } },
    select: { id: true },
  });
  for (const { id } of stuck) await enqueueExecution(id);
  if (stuck.length) logger.warn(`[INTENT] re-queued ${stuck.length} authorized intent(s)`);
  return count;
}

// Worker entry point. Safe to call more than once for the same intent.
export async function execute(intentId) {
  const { count } = await prisma.paymentIntent.updateMany({
    where: { id: intentId, status: "AUTHORIZED" },
    data: { status: "EXECUTING" },
  });
  if (count === 0) {
    logger.warn(`[INTENT] ${intentId} not in AUTHORIZED state, skipping`);
    return;
  }

  const intent = await prisma.paymentIntent.findUnique({ where: { id: intentId }, include: { user: true, account: true } });
  const { user, account } = intent;
  const amount = Number(intent.amount);
  const p = intent.payload;

  // Limits may have changed between draft and execution (e.g. two drafts in parallel).
  try {
    await checkLimits(user, amount);
  } catch (err) {
    await prisma.paymentIntent.update({ where: { id: intentId }, data: { status: "FAILED" } });
    await notify(user, intent.channel, `❌ Payment not sent: ${err.message}`);
    return;
  }

  const tx = await ledger.createPending({
    userId: user.id,
    accountId: account.id,
    intentId,
    reference: intent.idempotencyKey,
    amount,
    kind: intent.kind,
    description: intent.summary.split("\n")[0].slice(0, 190),
    destinationAccount: p.accountNumber,
    destinationBankCode: p.bankCode,
    destinationName: p.accountName,
  });

  let result;
  try {
    result = await callProvider(intent, account, user);
  } catch (err) {
    // Unexpected bug after the ledger row exists: leave it for reconciliation.
    logger.error(`[INTENT] ${intentId} provider call threw: ${err.message}`);
    result = { outcome: OUTCOME.UNKNOWN, raw: { error: "internal" } };
  }

  await ledger.settle(tx.reference, result.outcome, { providerRef: result.providerRef, raw: result.raw });
  await prisma.paymentIntent.update({
    where: { id: intentId },
    data: { status: result.outcome === OUTCOME.FAILED ? "FAILED" : "DONE" },
  });

  const settled = await prisma.transaction.findUnique({ where: { id: tx.id } });
  await notifyOutcome(user, account, intent, settled, result);
}

async function callProvider(intent, account, user) {
  const p = intent.payload;
  const amount = Number(intent.amount);
  const reference = intent.idempotencyKey;
  const debitAccount = account.accountNumber;

  switch (intent.kind) {
    case "TRANSFER":
      return PsbService.walletToOtherBanks({
        reference,
        accountNo: debitAccount,
        amount,
        narration: (p.narration || "Blocklo transfer").slice(0, 100),
        destinationAccount: p.accountNumber,
        destinationBankCode: p.bankCode,
        destinationName: p.accountName,
        senderName: `${user.firstName} ${user.lastName}`.trim(),
      });
    case "AIRTIME":
      return PsbVasService.buyAirtime({ reference, phoneNumber: p.phoneNumber, amount, network: p.network, debitAccount });
    case "DATA": {
      // Price comes from 9PSB at execution time, never from chat or the LLM.
      const plans = await PsbVasService.getDataPlans(p.phoneNumber);
      const plan = plans.find((x) => x.productId === p.productId);
      if (!plan || plan.price !== amount) return { outcome: OUTCOME.FAILED, raw: { error: "plan unavailable or price changed" } };
      return PsbVasService.buyData({ reference, phoneNumber: p.phoneNumber, productId: p.productId, amount, network: p.network, debitAccount });
    }
    case "BILL":
      return PsbVasService.payBill({ reference, billerId: p.billerId, amount, debitAccount, fields: p.fields });
    default:
      throw new Error(`Unsupported kind ${intent.kind}`);
  }
}

async function notify(user, channel, text, document) {
  if (channel !== "whatsapp" || !user.whatsappId) return;
  await WhatsAppService.sendReply(user.whatsappId, { text, document });
}

export async function notifyOutcome(user, account, intent, tx, result) {
  const ref = tx.reference;
  if (tx.status === "SUCCESS") {
    const token = result?.raw?.data?.token || result?.raw?.data?.accessToken;
    const details = token ? { Token: token } : {};
    const document = {
      buffer: await renderReceipt(tx, { customerName: `${user.firstName} ${user.lastName}`, sourceAccount: account.accountNumber, details }),
      filename: `receipt_${ref}.pdf`,
    };
    const tokenLine = token ? `\n\n🔑 Token: *${token}*` : "";
    await notify(user, intent.channel, `✅ Successful\n\n${intent.summary}\nRef: ${ref}${tokenLine}`, document);
  } else if (tx.status === "FAILED") {
    await notify(user, intent.channel, `❌ Payment failed\n\n${intent.summary}\nRef: ${ref}\n\nIf you were debited, it will be reversed. Contact support with this reference if it isn't.`);
  } else {
    await notify(user, intent.channel, `⏳ Processing\n\n${intent.summary}\nRef: ${ref}\n\nWe're confirming this with the bank and will message you shortly. Please don't retry.`);
  }
}

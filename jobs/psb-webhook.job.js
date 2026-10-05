import prisma from "../config/prisma.js";
import logger from "../config/logger.js";
import PsbService from "../services/psb.service.js";
import WhatsAppService from "../services/whatsapp.services.js";
import { reconcileTransaction } from "./reconcile.job.js";
import { naira } from "../utils/format.js";

// Processes one 9PSB webhook event. The webhook is treated as a *trigger*, not as
// the truth: outcomes are always confirmed with 9PSB before the ledger changes.

const pick = (obj, ...keys) => keys.map((k) => obj?.[k]).find((v) => v !== undefined && v !== null && v !== "");

export async function processPsbWebhook(payload) {
  // 1. Status update for one of our outgoing payments -> requery and settle.
  const reference = pick(payload, "transactionReference", "reference");
  if (reference) {
    const tx = await prisma.transaction.findUnique({ where: { reference }, include: { account: true, user: true } });
    if (tx && tx.type === "DEBIT") {
      if (["PENDING", "UNKNOWN"].includes(tx.status)) await reconcileTransaction(tx, { manual: true });
      return;
    }
  }

  // 2. Money received into one of our wallets.
  const accountNumber = pick(payload, "accountNumber", "creditAccount", "craccount", "beneficiaryAccountNumber");
  const sessionID = pick(payload, "sessionID", "sessionId");
  if (!accountNumber || !sessionID) {
    logger.info("[PSB WEBHOOK] event ignored: no known reference or inflow fields");
    return;
  }

  const account = await prisma.account.findUnique({ where: { accountNumber: String(accountNumber) }, include: { user: true } });
  if (!account) return;

  const inflowRef = `IN-${sessionID}`;
  if (await prisma.transaction.findUnique({ where: { reference: inflowRef } })) return;

  // Throws (and the job retries) unless 9PSB confirms the inflow.
  const confirmed = await PsbService.notificationRequery(String(sessionID), account.accountNumber);
  const amount = Number.parseFloat(pick(confirmed?.data, "amount", "transactionAmount") ?? pick(payload, "amount", "transactionAmount"));
  if (!Number.isFinite(amount) || amount <= 0) {
    logger.error(`[PSB WEBHOOK] inflow ${inflowRef} confirmed without a valid amount`);
    return;
  }
  const sender = pick(confirmed?.data, "originatorName", "senderName") || pick(payload, "originatorAccountName", "senderName", "originatorName") || "a sender";

  try {
    await prisma.transaction.create({
      data: {
        userId: account.userId,
        accountId: account.id,
        reference: inflowRef,
        providerRef: String(sessionID),
        amount,
        type: "CREDIT",
        kind: "INFLOW",
        status: "SUCCESS",
        description: `From ${sender}`.slice(0, 190),
        metadata: { webhook: payload, confirmation: confirmed?.data ?? null },
      },
    });
  } catch (err) {
    if (err.code === "P2002") return; // already recorded by a concurrent delivery
    throw err;
  }

  if (account.user.whatsappId) {
    await WhatsAppService.sendMessage(account.user.whatsappId, `💰 You received ${naira(amount)} from ${sender}.`);
  }
}

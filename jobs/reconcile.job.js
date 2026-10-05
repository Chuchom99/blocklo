import prisma from "../config/prisma.js";
import logger from "../config/logger.js";
import PsbService, { OUTCOME } from "../services/psb.service.js";
import PsbVasService from "../services/psb.vas.services.js";
import * as ledger from "../services/ledger.service.js";
import { notifyOutcome } from "../services/payment-intent.service.js";
import { audit } from "../services/audit.service.js";

// Settles PENDING/UNKNOWN debits by asking 9PSB what actually happened.
// After MAX_REQUERIES inconclusive answers a row is flagged for a human.

const MAX_REQUERIES = 12; // ~1 hour at the 5-minute schedule
const MIN_AGE_MS = 2 * 60_000;

async function requery(tx) {
  switch (tx.kind) {
    case "TRANSFER":
      return PsbService.requeryTransaction({
        transactionId: tx.reference,
        amount: Number(tx.amount),
        transactionType: "OTHER_BANKS",
        transactionDate: tx.createdAt.toISOString().slice(0, 10),
        accountNo: tx.account.accountNumber,
      });
    case "AIRTIME":
    case "DATA":
      return PsbVasService.getTopupStatus(tx.reference);
    case "BILL":
      return PsbVasService.getBillStatus(tx.reference);
    default:
      return { outcome: OUTCOME.UNKNOWN, raw: null };
  }
}

// tx must include { account, user }. Returns the outcome.
export async function reconcileTransaction(tx, { manual = false } = {}) {
  const result = await requery(tx);

  if (result.outcome === OUTCOME.UNKNOWN) {
    const flag = !manual && tx.requeryCount + 1 >= MAX_REQUERIES;
    await ledger.recordRequery(tx.id, { needsReview: flag });
    if (flag) {
      logger.error(`[RECONCILE] ${tx.reference} still unresolved after ${MAX_REQUERIES} requeries — needs manual review`);
      await audit("system", "transaction.needs_review", { target: tx.reference });
    }
    return result.outcome;
  }

  const changed = await ledger.settle(tx.reference, result.outcome, { raw: result.raw ?? undefined });
  if (changed && tx.intentId) {
    const intent = await prisma.paymentIntent.update({
      where: { id: tx.intentId },
      data: { status: result.outcome === OUTCOME.FAILED ? "FAILED" : "DONE" },
    });
    const settled = await prisma.transaction.findUnique({ where: { id: tx.id } });
    await notifyOutcome(tx.user, tx.account, intent, settled, result);
  }
  return result.outcome;
}

export async function runReconciliation() {
  const open = await ledger.findOpenForReconciliation({ olderThanMs: MIN_AGE_MS });
  for (const tx of open) {
    try {
      await reconcileTransaction(tx);
    } catch (err) {
      logger.error(`[RECONCILE] ${tx.reference} failed: ${err.message}`);
    }
  }
  if (open.length) logger.info(`[RECONCILE] checked ${open.length} open transaction(s)`);
}

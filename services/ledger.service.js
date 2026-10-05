import prisma from "../config/prisma.js";
import logger from "../config/logger.js";
import { OUTCOME } from "./psb.service.js";

// The ledger records every money movement. A row is written as PENDING *before*
// 9PSB is called, then settled from the provider's answer, the 9PSB webhook,
// or the reconciliation job. Settlement is idempotent: only open rows change.

const OPEN = ["PENDING", "UNKNOWN"];

export function createPending({
  userId, accountId, intentId, reference, amount, kind, description,
  destinationAccount, destinationBankCode, destinationName,
}) {
  return prisma.transaction.create({
    data: {
      userId,
      accountId,
      intentId,
      reference,
      amount,
      kind,
      type: "DEBIT",
      status: "PENDING",
      description,
      destinationAccount,
      destinationBankCode,
      destinationName,
    },
  });
}

// Move an open transaction to its final (or UNKNOWN) state. Returns true if this
// call changed it, so callers notify the user exactly once.
export async function settle(reference, outcome, { providerRef, raw } = {}) {
  const status = { [OUTCOME.SUCCESS]: "SUCCESS", [OUTCOME.FAILED]: "FAILED", [OUTCOME.UNKNOWN]: "UNKNOWN" }[outcome];
  if (!status) throw new Error(`Unknown outcome ${outcome}`);

  // UNKNOWN never overwrites UNKNOWN (nothing new to record).
  const from = status === "UNKNOWN" ? ["PENDING"] : OPEN;
  const { count } = await prisma.transaction.updateMany({
    where: { reference, status: { in: from } },
    data: {
      status,
      ...(providerRef && { providerRef }),
      ...(raw !== undefined && { metadata: raw }),
    },
  });
  if (count) logger.info(`[LEDGER] ${reference} -> ${status}`);
  return count > 0;
}

export function findOpenForReconciliation({ olderThanMs, limit = 50 }) {
  return prisma.transaction.findMany({
    where: {
      status: { in: OPEN },
      needsReview: false,
      type: "DEBIT",
      createdAt: { lt: new Date(Date.now() - olderThanMs) },
    },
    include: { account: true, user: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

export function recordRequery(id, { needsReview }) {
  return prisma.transaction.update({
    where: { id },
    data: { requeryCount: { increment: 1 }, lastRequeryAt: new Date(), ...(needsReview && { needsReview: true }) },
  });
}

// Sum of today's outgoing money that is done or may still go through (Africa/Lagos day).
export async function spentToday(userId) {
  // Lagos is UTC+1 all year (no DST).
  const LAGOS_OFFSET = 3600_000;
  const DAY = 86_400_000;
  const since = new Date(Math.floor((Date.now() + LAGOS_OFFSET) / DAY) * DAY - LAGOS_OFFSET);

  const result = await prisma.transaction.aggregate({
    _sum: { amount: true },
    where: { userId, type: "DEBIT", status: { in: ["PENDING", "SUCCESS", "UNKNOWN"] }, createdAt: { gte: since } },
  });
  return Number(result._sum.amount ?? 0);
}

import { subDays, format } from "date-fns";
import prisma from "../config/prisma.js";
import PsbService from "./psb.service.js";
import UserService from "./user.service.js";
import logger from "../config/logger.js";

/**
 * Handle "transfer" commands
 * Supports:
 *  - transfer 500 to 0123456789 (auto-detect 9PSB or other bank)
 *  - transfer 1000 to 1234567890 within 9psb
 *  - transfer 2000 to 1234567890 bank 011 (GTB)
 */
export async function handleTransfer(from, message, userId) {
  if (!userId) return "Please register first.";

  const match = message.match(
    /transfer\s+(\d+\.?\d*)\s+to\s+(\d+)(?:\s+bank\s+(\d+)|\s+within\s+9psb)?/i
  );
  if (!match) {
    return `Usage examples:
- transfer 500 to 0123456789
- transfer 1000 to 0123456789 within 9psb
- transfer 2000 to 0123456789 bank 011`;
  }

  const [, amount, destinationAccount, bankCode] = match;
  const isIntra9PSB = /within\s+9psb/i.test(message) || bankCode === "999991";

  try {
    const account = await prisma.account.findFirst({ where: { userId } });
    if (!account) return "No wallet found for your account.";

    const narration = `AI initiated transfer to ${destinationAccount}`;
    const merchant = { isFee: false };

    let result;

    if (isIntra9PSB) {
      // ✅ 9PSB → 9PSB transfer
      result = await PsbService.singleWalletTransfer({
        amount: parseFloat(amount),
        debitAccountNo: account.accountNumber,
        creditAccountNo: destinationAccount,
        narration,
        merchant,
      });

      return `✅ Transfer of ₦${amount} to ${destinationAccount} (within 9PSB) successful! Ref: ${
        result?.data?.transactionRef || "N/A"
      }`;
    } else {
      // ✅ Other bank transfer
      const destinationBankCode = bankCode || "011"; // default to GTB if not specified
      result = await PsbService.walletToOtherBanks({
        accountNo: account.accountNumber,
        amount: parseFloat(amount),
        narration,
        destinationAccount,
        destinationBankCode,
        merchant,
      });

      return `✅ Transfer of ₦${amount} to ${destinationAccount} (bank code ${destinationBankCode}) successful! Ref: ${
        result?.data?.transactionRef || "N/A"
      }`;
    }
  } catch (error) {
    logger.error(`Transfer error for ${userId}: ${error.message}`);
    return `❌ Transfer failed: ${error.message}`;
  }
}

/**
 * Fetch user wallet balance — always from live 9PSB
 */
export async function handleBalance(userId) {
  try {
    if (!userId) return "Please register first.";

    const account = await prisma.account.findFirst({ where: { userId } });
    if (!account) return "No wallet found.";

    const accountNo = account.accountNumber || account.accountNo;
    if (!accountNo) return "Your wallet is not yet linked. Please contact support.";

    const walletData = await PsbService.walletEnquiry(accountNo);

    // If PSB returns an error response, do NOT throw
    if (walletData?.responseCode && walletData.responseCode !== "00") {
      logger.warn(`[handleBalance] Non-success response: ${walletData.responseCode}`);
    }

    const balance =
      walletData?.data?.data?.availableBalance ??
      walletData?.data?.availableBalance ??
      walletData?.availableBalance ??
      0;

    const formatted = parseFloat(balance).toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    return `💰 Your wallet balance is ₦${formatted}`;
  } catch (err) {
    logger.error(`[handleBalance] Error: ${err.message}`);
    return "⚠️ Could not fetch your wallet balance at the moment.";
  }
}


export async function handleTransactionHistory(userId) {
  if (!userId) return "⚠️ Please register first.";

  try {
    const account = await prisma.account.findFirst({ where: { userId } });
    if (!account) return "⚠️ No wallet found.";

    // 1️⃣ Always start with local transactions
    let transactions = await prisma.transaction.findMany({
      where: { accountNumber: account.accountNumber },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    const lastTxn = transactions[0];
    const isStale =
      !lastTxn ||
      Date.now() - new Date(lastTxn.createdAt).getTime() > 30 * 60 * 1000; // > 30 mins

    // 2️⃣ Try fetching fresh transactions from 9PSB if stale or empty
    if (transactions.length === 0 || isStale) {
      try {
        const toDate = format(new Date(), "yyyy-MM-dd");
        const fromDate = format(subDays(new Date(), 30), "yyyy-MM-dd");

        const psbTxns = await PsbService.getTransactionHistory(
          account.accountNumber,
          fromDate,
          toDate,
          "50"
        );

        const txnList =
          psbTxns?.data?.data?.message &&
          Array.isArray(psbTxns.data.data.message)
            ? psbTxns.data.data.message
            : [];

        if (txnList.length > 0) {
          const formatted = txnList.map((txn) => {
            const isCredit = txn.credit && txn.credit !== "";
            const amount = parseFloat(
              (isCredit ? txn.credit : txn.debit).replace(/,/g, "")
            );
            return {
              reference: txn.referenceID,
              amount,
              type: isCredit ? "CREDIT" : "DEBIT",
              narration: txn.narration || "N/A",
              date: txn.transactionDate,
              accountNumber: account.accountNumber,
            };
          });

          // 🧠 Sync to DB
          for (const txn of formatted) {
            await prisma.transaction.upsert({
              where: { reference: txn.reference },
              update: txn,
              create: txn,
            });
          }

          transactions = formatted;
          logger.info(
            `✅ Synced ${transactions.length} transactions from 9PSB`
          );
        } else {
          logger.warn(`⚠️ No transactions returned from 9PSB`);
        }
      } catch (apiErr) {
        logger.warn(
          `⚠️ 9PSB fetch failed: ${apiErr.message}. Using local DB cache.`
        );
        // Re-fetch local transactions in case we didn’t have any before
        transactions = await prisma.transaction.findMany({
          where: { accountNumber: account.accountNumber },
          orderBy: { createdAt: "desc" },
          take: 10,
        });
      }
    }

    // 3️⃣ Format final result (local or synced)
    if (transactions.length === 0) return "📭 No transactions found.";

    const list = transactions
      .slice(0, 5)
      .map(
        (t) =>
          `${
            t.type === "CREDIT" ? "➕" : "➖"
          } ₦${t.amount.toLocaleString()} — ${t.narration} (${new Date(
            t.date
          ).toLocaleDateString()})`
      )
      .join("\n");

    return `📜 Your recent transactions:\n${list}`;
  } catch (error) {
    logger.error(`Transaction fetch error: ${error.message}`);
    return `❌ Could not fetch transactions: ${error.message}`;
  }
}





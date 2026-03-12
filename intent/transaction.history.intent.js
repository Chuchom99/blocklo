import prisma from "../config/prisma.js";
import logger from "../config/logger.js";
import { generateTransactionHistoryPDF } from "../utils/pdf.utils.js";

class TransactionHistoryService {
  static async process(userId, message, from) {
    const lower = message.toLowerCase().trim();

    if (
      lower.includes("transaction") ||
      lower.includes("history") ||
      lower.includes("statement") ||
      lower.includes("transact") ||
      lower.includes("mini statement") ||
      lower === "stmt" ||
      lower === "hist"
    ) {
      return await this.sendTransactionHistory(userId, from, message, 1); // ← pass message
    }

    if (
      lower.includes("more") ||
      lower.includes("next") ||
      lower.startsWith("page ")
    ) {
      const page = lower.match(/\d+/)
        ? parseInt(lower.match(/\d+/)?.[0])
        : null;
      return await this.sendTransactionHistory(
        userId,
        from,
        message,
        page || 2,
      ); // ← pass message
    }

    return null;
  }

  static async sendTransactionHistory(userId, from, userMessage, page = 1) {
    if (!userId) {
      return "I don't know who you are yet. Say *balance* to link your account.";
    }

    const limit = 10;
    const skip = (page - 1) * limit;

    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { accounts: { take: 1 } },
      });

      if (!user) {
        return "User not found. Please register first.";
      }

      if (!user.accounts?.[0]) {
        return "No account linked. Say *balance* to refresh.";
      }

      const accountId = user.accounts[0].id;

      const [transactions, total] = await Promise.all([
        prisma.transaction.findMany({
          where: { accountId }, // ← Use accountId, not userId (more accurate)
          orderBy: { createdAt: "desc" },
          skip,
          take: limit + 1,
          select: {
            amount: true,
            type: true,
            description: true,
            status: true,
            destinationAccount: true,
            destinationName: true,
            reference: true,
            createdAt: true,
            balanceAfter: true,
          },
        }),
        prisma.transaction.count({ where: { accountId } }),
      ]);

      const hasMore = transactions.length > limit;
      const txns = hasMore ? transactions.slice(0, limit) : transactions;

      if (txns.length === 0) {
        return page === 1
          ? "You have no transactions yet. Make your first transfer!"
          : "No more transactions.";
      }

      let text = `*Your Transaction History* (Page ${page} of ${Math.ceil(
        total / limit,
      )})\n\n`;
      txns.forEach((t, i) => {
        const sign = t.type === "CREDIT" ? "+" : "−";
        const amount = `₦${Math.abs(t.amount).toLocaleString()}`;
        const date = new Date(t.createdAt).toLocaleDateString("en-NG");
        const desc =
          t.description ||
          t.destinationName ||
          t.reference?.slice(-12) ||
          "Transaction";

        text += `${i + 1}. ${sign}${amount} • ${desc}\n   ${date} • ${
          t.status
        }\n\n`;
      });

      if (hasMore) {
        text += `_Reply *more* or *page ${
          page + 1
        }* for older transactions_\n\n`;
      }

      // PDF Statement Trigger
      const wantsPDF =
        userMessage.toLowerCase().includes("statement") ||
        userMessage.toLowerCase().includes("pdf") ||
        userMessage.toLowerCase().includes("mini");

      if (wantsPDF) {
        const pdfPath = await generateTransactionHistoryPDF({
          userId: user.id,
          transactions: txns.slice(0, 20),
          page,
          total,
          accountNumber: user.accounts[0].accountNumber,
        });

        text += `\nMini-statement attached (PDF)`;

        return {
          text,
          document: {
            url: `http://localhost:5000${pdfPath}`,
            filename: `Mini_Statement_${
              new Date().toISOString().split("T")[0]
            }.pdf`,
          },
        };
      }

      text += `_Reply *statement* for PDF version_`;
      return { text };
    } catch (error) {
      logger.error("[HISTORY] Error:", error);
      return "Sorry, couldn't load your transactions. Try again.";
    }
  }
}

export default TransactionHistoryService;

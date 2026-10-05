import prisma from "../config/prisma.js";
import { clearState, setState } from "../services/conversation.state.js";
import { naira } from "../utils/format.js";
import { renderStatement } from "../utils/receipt.pdf.js";

const PAGE_SIZE = 10;
const START = /\b(history|transactions?|statement|mini statement|stmt)\b/i;

class TransactionHistoryService {
  static async start(ctx, input) {
    if (!START.test(input)) return null;
    return this.page(ctx, 1, /statement|stmt|pdf/i.test(input));
  }

  // Only "more" right after a history page continues it.
  static async continue(ctx, input, state) {
    if (/^(more|next)$/i.test(input.trim())) return this.page(ctx, state.page + 1, false);
    await clearState(ctx.from);
    return null;
  }

  static async page(ctx, page, asPdf) {
    const where = { accountId: ctx.account.id };
    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
      prisma.transaction.count({ where }),
    ]);

    if (!transactions.length) {
      await clearState(ctx.from);
      return page === 1 ? "You have no transactions yet." : "No more transactions.";
    }

    const lines = transactions.map((t, i) => {
      const sign = t.type === "CREDIT" ? "+" : "−";
      const date = new Date(t.createdAt).toLocaleDateString("en-NG", { timeZone: "Africa/Lagos" });
      return `${(page - 1) * PAGE_SIZE + i + 1}. ${sign}${naira(t.amount)} • ${t.description || t.destinationName || "Transaction"}\n   ${date} • ${t.status}`;
    });

    const hasMore = page * PAGE_SIZE < total;
    if (hasMore) await setState(ctx.from, { intent: "history", page }, 600);
    else await clearState(ctx.from);

    const text = `*Transaction history* (page ${page} of ${Math.ceil(total / PAGE_SIZE)})\n\n${lines.join("\n\n")}${
      hasMore ? "\n\n_Reply *more* for older transactions_" : ""
    }${asPdf ? "" : "\n_Reply *statement* for a PDF_"}`;

    if (!asPdf) return { text };
    return {
      text,
      document: {
        buffer: await renderStatement({
          customerName: `${ctx.user.firstName} ${ctx.user.lastName}`,
          accountNumber: ctx.account.accountNumber,
          transactions,
        }),
        filename: `statement_${new Date().toISOString().slice(0, 10)}.pdf`,
      },
    };
  }
}

export default TransactionHistoryService;

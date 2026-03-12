import PsbService from "../services/psb.service.js";
// import UserService from "../services/user.service.js";
import prisma from "../config/prisma.js";
import logger from "../config/logger.js";
import { generateTransactionReceiptPDF } from "../utils/pdf.utils.js";
import { v4 as uuidv4 } from "uuid";
import { langchainService } from "../services/ai.services.js";

class TransferIntentService {
  static async process(userId, message, from) {
    const normalizedMessage = message.toLowerCase().trim();

    // Pattern: "transfer X to YYY" or "send X to YYY" or "pay X to YYY"
    const transferPatterns = [
      /transfer\s+(\d+(?:\.\d{2})?)\s+to\s+(\d{10})/i,
      /send\s+(\d+(?:\.\d{2})?)\s+to\s+(\d{10})/i,
      /pay\s+(\d+(?:\.\d{2})?)\s+to\s+(\d{10})/i,
      /xfer\s+(\d+(?:\.\d{2})?)\s+to\s+(\d{10})/i,
    ];

    for (const pattern of transferPatterns) {
      const match = normalizedMessage.match(pattern);
      if (match) {
        const [, amount, accountNumber] = match;

        logger.info(
          `[TRANSFER] Detected transfer intent: ${amount} to ${accountNumber}`
        );

        return await this.handleTransferIntent(
          userId,
          parseFloat(amount),
          accountNumber.trim(),
          from
        );
      }
    }

    return null;
  }

  static async handleTransferIntent(userId, amount, destinationAccount, from) {
    try {
      // 1. Reuse the working user lookup (never fails)
      const userContext = await langchainService.getUserContext(from);
      if (!userContext?.accountNumber) {
        return "I can't verify your account right now. Say *balance* to refresh.";
      }

      // 2. Get full user + account safely
      const user = await prisma.user.findFirst({
        where: {
          accounts: { some: { accountNumber: userContext.accountNumber } },
        },
        include: {
          accounts: {
            where: { accountNumber: userContext.accountNumber },
            take: 1,
          },
        },
      });

      if (!user || !user.accounts[0]) {
        return "Account not found. Please contact support.";
      }

      const account = user.accounts[0];
      const senderName =
        `${user.firstName} ${user.lastName || ""}`.trim() || userContext.name;

      // 3. Validate amount
      if (amount < 50) return "Minimum transfer is ₦50.";
      if (amount > 100000) return "Test mode limit: max ₦100,000 per transfer.";

      // 4. Check balance
      const currentBalance = await PsbService.getBalance(account.accountNumber);
      logger.info(
        `[TRANSFER] ${senderName} | Balance: ₦${currentBalance.toLocaleString()} | Sending: ₦${amount}`
      );

      if (currentBalance < amount) {
        return `Insufficient funds.\nBalance: ₦${currentBalance.toLocaleString()}\nRequested: ₦${amount.toLocaleString()}`;
      }

      // 5. SKIP name enquiry in test mode — use fallback name
      const destinationName = "Test Receiver"; // 9PSB test accounts don't support name enquiry

      // 6. Generate unique narration/ref
      const timestamp = Date.now();
      const shortId = Math.random().toString(36).substr(2, 6).toUpperCase();
      const narration = `BLOCKLO/TEST/TRF${timestamp}${shortId}`;

      logger.info(
        `[TRANSFER] Initiating test transfer → ${destinationAccount} | ₦${amount} | Ref: ${narration}`
      );

      // 7. Execute transfer
      const transferResult = await PsbService.walletToOtherBanks({
        accountNo: account.accountNumber,
        amount: amount.toString(),
        narration,
        destinationAccount,
        destinationBankCode: "120001", // 9PSB's own code in test
        destinationName,
        senderName,
        merchant: {
          isFee: false,
          merchantFeeAccount: "",
          merchantFeeAmount: "",
        },
      });

      // 8. Success path
      if (
        transferResult?.status?.toUpperCase() === "SUCCESS" ||
        transferResult?.success
      ) {
        const newBalance = currentBalance - amount;

        // Generate PDF receipt
        const receiptPath = await generateTransactionReceiptPDF({
          senderName,
          senderAccount: account.accountNumber,
          recipientName: destinationName,
          recipientAccount: destinationAccount,
          amount,
          transactionRef: narration,
          date:
            new Date().toLocaleDateString("en-NG") +
            " " +
            new Date().toLocaleTimeString("en-NG"),
          balanceAfter: newBalance.toLocaleString("en-NG"),
        });

        logger.info(
          `TRANSFER SUCCESS | ${narration} | -₦${amount} | Balance: ₦${newBalance.toLocaleString()}`
        );

        return {
          text:
            `TEST TRANSFER SUCCESSFUL!\n\n` +
            `Amount: ₦${amount.toLocaleString()}\n` +
            `To: ${destinationName}\n` +
            `Account: ${destinationAccount.slice(-4)}\n` +
            `Ref: ${narration.slice(-12)}\n` +
            `Date: ${new Date().toLocaleString("en-NG")}\n\n` +
            `New Balance: ₦${newBalance.toLocaleString()}\n\n` +
            `Receipt attached (test mode)`,
          document: {
            url: `http://localhost:5000${receiptPath}`,
            filename: `receipt_${narration.slice(-8)}.pdf`,
          },
        };
      }

      // 9. Failed
      const errorMsg =
        transferResult?.message || JSON.stringify(transferResult);
      logger.error(`[TRANSFER] Failed: ${errorMsg}`);
      return `Transfer failed (test mode):\n${errorMsg}`;
    } catch (error) {
      logger.error(`[TRANSFER] Exception:`, {
        from,
        amount,
        destinationAccount,
        error: error.message,
        stack: error.stack,
      });

      return `Transfer failed. Please try again.\nError: ${error.message}`;
    }
  }
}

export default TransferIntentService;



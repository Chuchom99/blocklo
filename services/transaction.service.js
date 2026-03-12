import prisma from "../config/prisma.js";
import walletService from "./wallet.service.js";
import bcrypt from "bcryptjs";

class TransactionService {
  
  // Verify PIN
  async verifyPin(userId, pin) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) throw new Error("User not found");

    const isMatch = await bcrypt.compare(pin, user.transactionPin);
    if (!isMatch) throw new Error("Invalid PIN");

    return true;
  }

  // Create transaction record
  async createTransaction(userId, type, amount, pin) {
    // 1. Verify PIN
    await this.verifyPin(userId, pin);

    // 2. Create a reference
    const reference = `TXN_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    // 3. Handle transaction logic
    let status = "failed";

    try {
      if (type === "deposit") {
        await walletService.creditWallet(userId, amount);
      } else if (type === "withdrawal") {
        await walletService.debitWallet(userId, amount);
      } else {
        throw new Error("Invalid transaction type");
      }

      status = "success";
    } catch (err) {
      console.error("Transaction error:", err.message);
    }

    // 4. Save transaction record
    const transaction = await prisma.transaction.create({
      data: {
        userId,
        type,
        amount,
        status,
        reference,
      },
    });

    return transaction;
  }

  // Fetch transactions for a user
  async getUserTransactions(userId) {
    return prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  // Fetch single transaction
  async getTransactionByReference(reference) {
    return prisma.transaction.findUnique({
      where: { reference },
    });
  }
}

export default new TransactionService();

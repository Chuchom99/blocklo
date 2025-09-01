import prisma from "../config/prisma.js";
import bcrypt from "bcryptjs";

/**
 * Validate transaction pin
 */
const validatePin = async (userId, pin) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { transactionPin: true }
  });

  if (!user || !user.transactionPin) {
    throw new Error("Transaction PIN not set");
  }

  const isValid = await bcrypt.compare(pin, user.transactionPin);
  if (!isValid) {
    throw new Error("Invalid transaction PIN");
  }

  return true;
};

/**
 * Credit wallet
 */
const creditWallet = async (userId, amount, pin) => {
  await validatePin(userId, pin);

  return prisma.wallet.update({
    where: { userId },
    data: { balance: { increment: amount } },
  });
};

/**
 * Debit wallet
 */
const debitWallet = async (userId, amount, pin) => {
  await validatePin(userId, pin);

  const wallet = await prisma.wallet.findUnique({ where: { userId } });

  if (!wallet || wallet.balance < amount) {
    throw new Error("Insufficient funds");
  }

  return prisma.wallet.update({
    where: { userId },
    data: { balance: { decrement: amount } },
  });
};

/**
 * Get wallet balance
 */
const getBalance = async (userId) => {
  return prisma.wallet.findUnique({
    where: { userId },
    select: { balance: true },
  });
};

export default {
  creditWallet,
  debitWallet,
  getBalance,
};

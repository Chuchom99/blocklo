import prisma from "../config/prisma.js";
import PsbService from "./psb.service.js";
import { BeneficiaryService } from "./beneficiary.service.js";
import logger from "../config/logger.js";


export class TransferIntentService {
  // === HANDLE "send 5000 to babe" ===
static async handleTransfer(userId, message, from) {
  const match = message.match(/send\s+(\d+)\s+to\s+(.+)/i);
  if (!match) return null;

  const amount = match[1];
  const alias = match[2].trim().toLowerCase();

  try {
    const account = await prisma.account.findFirst({ where: { userId } });
    if (!account) return "No wallet.";

    const beneficiary = await BeneficiaryService.findByAlias(userId, alias);
    if (!beneficiary) return `No saved "${alias}". Save first.`;

    // === 9PSB INTERNAL TRANSFER ===
    if (beneficiary.bankCode === "999") {
      const result = await PsbService.singleWalletTransfer(
        account.accountNumber,
        amount,
        `Transfer to ${beneficiary.accountName}`,
        { isFee: false },
        "debit"
      );

      if (!result.success) throw new Error(result.message || "Transfer failed");

      return `Sent ₦${amount} to ${beneficiary.accountName} (${alias})\nRef: ${result.data?.transactionId || "N/A"}`;
    }

    // === EXTERNAL BANK – VALIDATE NAME ON TRANSFER ===
    const enquiry = await PsbService.otherBankEnquiry(beneficiary.accountNo, beneficiary.bankCode);
    if (!enquiry?.accountName) throw new Error("Account not valid");

    const result = await PsbService.walletToOtherBanks({
      accountNo: account.accountNumber,
      amount,
      narration: `Transfer to ${enquiry.accountName}`,
      destinationAccount: beneficiary.accountNo,
      destinationBankCode: beneficiary.bankCode,
      destinationName: enquiry.accountName,
      merchant: { isFee: false },
      senderName: account.accountName,
    });

    if (!result.success && result.status !== "SUCCESS") {
      throw new Error(result.message || "Transfer failed");
    }

    // Update saved name
    await prisma.beneficiary.update({
      where: { userId_alias: { userId, alias } },
      data: { accountName: enquiry.accountName },
    });

    return `Sent ₦${amount} to ${enquiry.accountName} (${alias})\nRef: ${result.data?.reference || "N/A"}`;
  } catch (err) {
    logger.error(`[TRANSFER] Failed: ${err.message}`);
    return `Transfer failed: ${err.message}`;
  }
}


  // === HANDLE "save babe 0123456789 058" ===
static async handleSaveBeneficiary(userId, message) {
  const match = message.match(/^save\s+([^\d]+)\s+(\d{10})\s+(.+)$/i);
  if (!match) return null;

  const [, alias, accountNo, bankInput] = match;

  return await BeneficiaryService.save(userId, alias.trim(), accountNo, bankInput.trim());
}


  // === HANDLE "my beneficiaries" ===
  static async handleListBeneficiaries(userId, message) {
    const lower = message.toLowerCase();
    if (!lower.includes("beneficiar") && !lower.includes("save")) return null;

    // If asking to save → show help
    if (lower.includes("save") && lower.includes("beneficiar")) {
      return "To save a beneficiary, reply:\n`save <alias> <account> <bank name>`\nExample: `save babe 0123456789 GTBank`";
    }

    // Otherwise → list saved
    return await BeneficiaryService.list(userId);
  }

  // === PROCESS ===
  static async process(userId, message, from) {
    const handlers = [
      this.handleSaveBeneficiary,
      this.handleListBeneficiaries,
      this.handleTransfer,
    ];

    for (const h of handlers) {
      const r = await h(userId, message, from);
      if (r) return r;
    }
    return null;
  }
}

// services/beneficiary.service.js

import prisma from "../config/prisma.js";
import { BankService } from "./bank.service.js";
import PsbService from "./psb.service.js";
import logger from "../config/logger.js";

export class BeneficiaryService {
  static async save(userId, alias, accountNo, bankInput) {
    alias = alias.trim().toLowerCase();
    const input = bankInput.trim().toLowerCase();

    try {
      let accountName = "Pending Verification";
      let bankName = bankInput;
      let bankCode = "120001"; // fallback
      let isValidated = false;

      // === INTERNAL 9PSB TRANSFER ===
      if (["9psb", "psb", "internal", "wallet", "blocklo"].includes(input)) {
        const account = await prisma.account.findUnique({
          where: { accountNumber: accountNo }
        });

        if (!account) return `9PSB account ${accountNo} not found.`;

        accountName = account.accountName;
        bankName = "9 Payment Service Bank";
        bankCode = "120001";
        isValidated = true;
      }
      // === EXTERNAL BANK ===
      else {
        const bank = await BankService.findCode(bankInput);
        if (!bank) {
          return `I don't recognize "${bankInput}". Try full name like "GTBank", "Access Bank", "Zenith", etc.`;
        }

        bankCode = bank.code;
        bankName = bank.name.toUpperCase().replace("plc", "Plc");

        // === NAME ENQUIRY (only try if not in obvious test mode) ===
        try {
          const enquiry = await PsbService.otherBankEnquiry(accountNo, bankCode);
          if (enquiry?.accountName) {
            accountName = enquiry.accountName;
            isValidated = true;
            logger.info(`[BENEFICIARY] Name enquiry success: ${accountName}`);
          } else {
            accountName = "Name enquiry failed (test mode?)";
          }
        } catch (err) {
          // In test mode, 9PSB returns 400 → safe to ignore
          if (err.response?.status === 400 || err.message.includes("bank is required")) {
            accountName = "Verification skipped (test mode)";
          } else {
            logger.warn(`[BENEFICIARY] Name enquiry failed: ${err.message}`);
            accountName = "Could not verify name";
          }
        }
      }

      // === SAVE OR UPDATE ===
      const beneficiary = await prisma.beneficiary.upsert({
        where: { userId_alias: { userId, alias } },
        update: {
          accountNo,
          bankCode,
          bankName,
          accountName,
          isValidated,
        },
        create: {
          userId,
          alias,
          accountNo,
          bankCode,
          bankName,
          accountName,
          isValidated,
        },
      });

      const status = isValidated ? "Verified" : "Saved (not verified)";
      return `Beneficiary saved!\n\n` +
             `*${alias.toUpperCase()}*\n` +
             `${accountName}\n` +
             `${accountNo} • ${bankName}\n` +
             `${status}`;

    } catch (err) {
      logger.error(`[BENEFICIARY] Save failed:`, err);
      return `Failed to save beneficiary: ${err.message}`;
    }
  }

  // === LIST BENEFICIARIES ===
  static async list(userId) {
    const list = await prisma.beneficiary.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    if (list.length === 0) return "You have no saved beneficiaries.\n\nReply: `save <name> <account> <bank>`";

    let reply = "*Your Saved Beneficiaries*\n\n";
    list.forEach((b, i) => {
      const check = b.isValidated ? "Verified" : "Warning (not verified)";
      reply += `${i + 1}. *${b.alias.toUpperCase()}*\n   ${b.accountName}\n   ${b.accountNo} • ${b.bankName}\n   ${check}\n\n`;
    });

    reply += `_Reply with alias to send money (e.g. "babe 500")_`;
    return reply;
  }

  // === FIND BY ALIAS ===
  static async findByAlias(userId, alias) {
    return await prisma.beneficiary.findUnique({
      where: { userId_alias: { userId, alias: alias.toLowerCase().trim() } },
    });
  }
}
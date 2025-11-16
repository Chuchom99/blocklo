import prisma from "../config/prisma.js";
import PsbService from "./psb.service.js";
import { BankService } from "./bank.service.js";
import redis from "../config/redis.js";
import logger from "../config/logger.js";

export class BeneficiaryService {
  // === SAVE WITH CONFIRMATION ===


// static async save(userId, alias, accountNo, bankInput) {
//   alias = alias.toLowerCase().trim();
//   const lower = bankInput.toLowerCase().trim();

//   try {
//     let accountName, bankName, bankCode;

//     // === 9PSB INTERNAL ===
//     if (lower === "9psb" || lower === "psb" || lower === "internal") {
//       const account = await prisma.account.findUnique({ where: { accountNumber: accountNo } });
//       if (!account) return "Account not found in 9PSB.";

//       accountName = account.accountName;
//       bankName = "9PSB";
//       bankCode = "999";
//     }
//     // === EXTERNAL BANK ===
//     else {
//       const bank = await BankService.findCode(bankInput);
//       if (!bank) return `Bank not found: ${bankInput}`;

//       const enquiry = await PsbService.otherBankEnquiry(accountNo, bank.code);
//       if (!enquiry?.accountName) return "Invalid account number.";

//       accountName = enquiry.accountName;
//       bankName = enquiry.bankName || bankInput;
//       bankCode = bank.code;
//     }

//     // === SAVE INSTANTLY ===
//     await prisma.beneficiary.upsert({
//       where: { userId_alias: { userId, alias } },
//       update: { accountNo, bankCode, bankName, accountName, isValidated: true },
//       create: { userId, alias, accountNo, bankCode, bankName, accountName, isValidated: true },
//     });

//     return `Saved "${alias}" → ${accountName} (${accountNo} @ ${bankName})`;
//   } catch (err) {
//     logger.error(`[BENEFICIARY] Save failed: ${err.message}`);
//     return `Save failed: ${err.message}`;
//   }
// }


// src/services/beneficiary.service.js
static async save(userId, alias, accountNo, bankInput) {
  alias = alias.toLowerCase().trim();
  const lower = bankInput.toLowerCase().trim();

  try {
    let accountName, bankName, bankCode;

    // === 9PSB INTERNAL ===
    if (lower === "9psb" || lower === "psb" || lower === "internal") {
      const account = await prisma.account.findUnique({ where: { accountNumber: accountNo } });
      if (!account) return "Account not found in 9PSB.";

      accountName = account.accountName;
      bankName = "9PSB";
      bankCode = "999";
    }
    // === EXTERNAL BANK – ONLY USE getBanks() ===
    else {
      const bank = await BankService.findCode(bankInput);
      if (!bank) return `Bank not found: ${bankInput}. Try full name (e.g. GTBank Plc).`;

      bankCode = bank.code;
      bankName = bank.name; // e.g. "gtbank plc"
      accountName = "Pending"; // Optional: set later via transfer
    }

    // === SAVE INSTANTLY ===
    await prisma.beneficiary.upsert({
      where: { userId_alias: { userId, alias } },
      update: { accountNo, bankCode, bankName, accountName, isValidated: true },
      create: { userId, alias, accountNo, bankCode, bankName, accountName, isValidated: true },
    });

    return `Saved "${alias}" → ${accountName} (${accountNo} @ ${bankName})`;
  } catch (err) {
    logger.error(`[BENEFICIARY] Save failed: ${err.message}`);
    return `Save failed: ${err.message}`;
  }
}
  // === FIND & LIST (unchanged) ===
  static async findByAlias(userId, alias) {
    return await prisma.beneficiary.findUnique({
      where: { userId_alias: { userId, alias } },
    });
  }

  static async list(userId) {
    const list = await prisma.beneficiary.findMany({
      where: { userId },
      select: { alias: true, accountName: true, accountNo: true, bankName: true },
    });

    if (!list.length) return "No saved beneficiaries.";
    return "Saved:\n" + list.map(b => `• ${b.alias} → ${b.accountName} (${b.accountNo} @ ${b.bankName})`).join("\n");
  }
}
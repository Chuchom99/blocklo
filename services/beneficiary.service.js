import prisma from "../config/prisma.js";
import config from "../config/env.js";
import PsbService from "./psb.service.js";
import { BankService } from "./bank.service.js";
import { PSB_BANK_CODE_9PSB } from "../utils/constant.js";
import { maskAccount } from "../utils/format.js";

// Resolve the real account holder name before money is sent or a beneficiary is saved.
// Returns null when the account can't be verified.
export async function resolveAccountName(accountNumber, bankCode) {
  if (bankCode === PSB_BANK_CODE_9PSB) {
    const local = await prisma.account.findUnique({ where: { accountNumber }, select: { accountName: true } });
    if (local?.accountName) return local.accountName;
  }
  const name = await PsbService.otherBankEnquiry(accountNumber, bankCode);
  if (name) return name;
  // 9PSB sandbox accounts don't support name enquiry.
  return config.psb.isSandbox ? "UNVERIFIED (sandbox)" : null;
}

export class BeneficiaryService {
  static async save(userId, alias, accountNo, bankInput) {
    const bank = await BankService.findCode(bankInput);
    if (!bank) return `I don't recognise the bank "${bankInput}". Try the full name, e.g. "GTBank", "Access Bank", "9PSB".`;

    const accountName = await resolveAccountName(accountNo, bank.code);
    if (!accountName) return "I couldn't verify that account. Please check the number and bank.";

    const key = alias.trim().toLowerCase();
    await prisma.beneficiary.upsert({
      where: { userId_alias: { userId, alias: key } },
      update: { accountNo, bankCode: bank.code, bankName: bank.name, accountName, isValidated: true },
      create: { userId, alias: key, accountNo, bankCode: bank.code, bankName: bank.name, accountName, isValidated: true },
    });
    return `Beneficiary saved ✅\n\n*${key.toUpperCase()}*\n${accountName}\n${maskAccount(accountNo)} • ${bank.name}\n\nSend money with: *send 2000 to ${key}*`;
  }

  static async list(userId) {
    const list = await prisma.beneficiary.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
    if (list.length === 0) return "You have no saved beneficiaries yet.\n\nTo save one: *save mom 0123456789 GTBank*";
    const rows = list.map((b, i) => `${i + 1}. *${b.alias.toUpperCase()}*\n   ${b.accountName}\n   ${maskAccount(b.accountNo)} • ${b.bankName}`);
    return `*Your saved beneficiaries*\n\n${rows.join("\n\n")}\n\nSend with: *send 2000 to <name>*`;
  }

  static findByAlias(userId, alias) {
    return prisma.beneficiary.findUnique({ where: { userId_alias: { userId, alias: alias.toLowerCase().trim() } } });
  }

  static async remove(userId, alias) {
    const { count } = await prisma.beneficiary.deleteMany({ where: { userId, alias: alias.toLowerCase().trim() } });
    return count > 0;
  }
}

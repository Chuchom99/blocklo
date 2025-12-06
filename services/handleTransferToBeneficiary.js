import prisma from "../config/prisma.js";
import PsbService from "./psb.service.js";
import { BeneficiaryService } from "./beneficiary.service.js";

export class BeneficiaryIntentService {

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
    ];

    for (const h of handlers) {
      const r = await h(userId, message, from);
      if (r) return r;
    }
    return null;
  }
}


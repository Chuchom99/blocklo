import PsbService from "./psb.service.js";
import logger from "../config/logger.js";
import { PSB_BANK_CODE_9PSB } from "../utils/constant.js";

// Common names people type, mapped to a word that appears in the official bank name.
const ALIASES = {
  gtb: "guaranty", gtbank: "guaranty", gtco: "guaranty",
  uba: "united bank for africa",
  fbn: "first bank", firstbank: "first bank",
  fcmb: "first city",
  opay: "opay", palmpay: "palmpay", kuda: "kuda", moniepoint: "moniepoint",
};

const NINE_PSB_NAMES = ["9psb", "9 psb", "psb", "9 payment service bank", "9mobile psb", "blocklo"];

export class BankService {
  static cache = null;
  static cacheExpiry = 0;

  static async getBanks() {
    if (this.cache && Date.now() < this.cacheExpiry) return this.cache;
    try {
      const data = await PsbService.getBanks();
      const banks = data?.bankList || data || [];
      this.cache = banks
        .map((b) => ({ name: String(b.bankName || "").trim(), code: String(b.bankCode || b.nibssBankCode || "") }))
        .filter((b) => b.name && b.code);
      this.cacheExpiry = Date.now() + 3600_000;
      return this.cache;
    } catch (err) {
      logger.error(`[BANK] fetch failed: ${err.message}`);
      return this.cache || [];
    }
  }

  // Returns { name, code } or null. Ambiguous input returns null rather than a guess.
  static async findCode(bankInput) {
    const input = String(bankInput || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!input) return null;
    if (NINE_PSB_NAMES.includes(input)) return { name: "9PSB", code: PSB_BANK_CODE_9PSB };

    const banks = await this.getBanks();
    const byCode = banks.find((b) => b.code === input);
    if (byCode) return byCode;

    const needle = ALIASES[input.replace(/\s/g, "")] || input;
    const exact = banks.find((b) => b.name.toLowerCase() === needle);
    if (exact) return exact;
    const matches = banks.filter((b) => b.name.toLowerCase().includes(needle));
    return matches.length === 1 ? matches[0] : null;
  }
}

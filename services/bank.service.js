// src/services/bank.service.js
import PsbService from "./psb.service.js";
import logger from "../config/logger.js";

export class BankService {
  static cache = null;
  static cacheExpiry = 0;

  // === GET BANKS WITH CACHE ===
  static async getBanks() {
    const now = Date.now();
    if (this.cache && now < this.cacheExpiry) {
      return this.cache;
    }

    try {
      const data = await PsbService.getBanks();
      const banks = data.bankList || data;
      this.cache = banks.map(b => ({
        name: b.bankName.toLowerCase(),
        code: b.bankCode || b.nibssBankCode,
        short: b.bankName.split(" ")[0].toLowerCase(), // "gtbank"
      }));
      this.cacheExpiry = now + 3600000; // 1 hour
      return this.cache;
    } catch (err) {
      logger.error(`[BANK] Fetch failed: ${err.message}`);
      return [];
    }
  }

  // === FIND CODE BY NAME ===
  static async findCode(bankInput) {
    const banks = await this.getBanks();
    const input = bankInput.toLowerCase().trim();

    return banks.find(b =>
      b.name.includes(input) ||
      b.short.includes(input) ||
      b.code === input
    );
  }
}
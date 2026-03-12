// services/beneficiary.intent.service.js
import { BeneficiaryService } from "../services/beneficiary.service.js";

export class BeneficiaryIntentService {
  static async process(userId, message, from) {
    const lower = message.toLowerCase().trim();

    // CATCH ANYTHING RELATED TO SAVING
    const saveKeywords = ["save", "add", "remember", "store", "beneficiar", "account", "person", "recipient"];
    const hasSaveIntent = saveKeywords.some(k => lower.includes(k));

    if (hasSaveIntent) {
      // EXACT MATCH: save babe 0123456789 GTBank
      const exactMatch = message.match(/save\s+([a-zA-Z][a-zA-Z0-9]*)\s+(\d{10})\s+(.+)/i);
      if (exactMatch) {
        const [, alias, accountNo, bankInput] = exactMatch; // ← THIS COMMA IS CRITICAL

        return await BeneficiaryService.save(
          userId,
          alias.trim(),
          accountNo.trim(),
          bankInput.trim()
        );
      }

      // Wrong format → help user
      return (
        "To save a beneficiary, reply exactly like this:\n\n" +
        "• `save babe 0123456789 GTBank`\n" +
        "• `save mom 0023456789 Access`\n" +
        "• `save dad 1100069532 9PSB`\n\n" +
        "I save instantly — no test transfer needed!"
      );
    }

    // LIST BENEFICIARIES
    if (lower.includes("beneficiar") || lower.includes("saved") || lower === "my people" || lower === "list") {
      return await BeneficiaryService.list(userId);
    }

    return null;
  }
}
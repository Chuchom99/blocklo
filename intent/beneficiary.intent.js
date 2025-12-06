

// import { BeneficiaryService } from "../services/beneficiary.service.js";

// export class BeneficiaryIntentService {
//   static async process(userId, message, from) {
//     const lower = message.toLowerCase().trim();

//     // 1. CATCH ANY ATTEMPT TO SAVE A BENEFICIARY — EVEN IF FORMAT IS WRONG
//     if (
//       lower.includes("save") &&
//       (lower.includes("beneficiar") ||
//         lower.includes("account") ||
//         lower.includes("person") ||
//         lower.includes("recipient") ||
//         lower.includes("add") ||
//         lower.includes("remember") ||
//         lower.includes("store"))
//     ) {
//       // User is clearly trying to save — help them!
//       return (
//         "To save a beneficiary, reply exactly like this:\n\n" +
//         "• `save babe 0123456789 GTBank`\n" +
//         "• `save mom 0023456789 Access`\n" +
//         "• `save john 1100069532 9PSB`\n\n" +
//         "I’ll verify the name and save it for faster transfers!"
//       );
//     }

//     // 2. LIST BENEFICIARIES
//     if (
//       lower.includes("beneficiar") ||
//       lower.includes("saved") ||
//       lower === "my people" ||
//       lower === "list" ||
//       lower === "show me"
//     ) {
//       return await BeneficiaryService.list(userId);
//     }

//     // 3. EXACT SAVE COMMANDS — MULTIPLE PATTERNS
//     const savePatterns = [
//       /^save\s+([a-zA-Z][a-zA-Z0-9]*)\s+(\d{10})\s+(.+)/i,
//       /^add\s+beneficiary\s+([a-zA-Z][a-zA-Z0-9]*)\s+(\d{10})\s+(.+)/i,
//       /^remember\s+([a-zA-Z][a-zA-Z0-9]*)\s+(\d{10})\s+(.+)/i,
//       /^save\s+(.+?)\s+(\d{10})\s+at\s+(.+)/i,
//       /save\s+([a-zA-Z][a-zA-Z0-9]*)\s+(\d{10})\s+(.+)/i,
//     ];

//     for (const pattern of savePatterns) {
//       const match = message.match(pattern);
//       if (match) {
//         const [, alias, accountNo, bankInput] = match;
//         const cleanAlias = alias.trim();
//         const cleanAccountNo = accountNo.trim();
//         const cleanBank = bankInput.trim();

//         if (cleanAccountNo.length !== 10) {
//           return "Account number must be 10 digits. Try again.";
//         }

//         return await BeneficiaryService.save(
//           userId,
//           cleanAlias,
//           cleanAccountNo,
//           cleanBank
//         );
//       }
//     }

//     return null;
//   }
// }



// services/beneficiary.intent.service.js

// import { BeneficiaryService } from "../services/beneficiary.service.js";

// export class BeneficiaryIntentService {
//   static async process(userId, message, from) {
//     const lower = message.toLowerCase().trim();

//     // CATCH ANYTHING THAT EVEN SMELLS LIKE SAVING A BENEFICIARY
//     const saveKeywords = ["save", "add", "remember", "store", "beneficiar", "account", "person", "recipient"];
//     const hasSaveIntent = saveKeywords.some(k => lower.includes(k));

//     if (hasSaveIntent) {
//       // EXACT MATCH: save babe 0123456789 GTBank
//       const exactMatch = message.match(/save\s+([a-zA-Z][a-zA-Z0-9]*)\s+(\d{10})\s+(.+)/i);
//       if (exactMatch) {
//         const [ alias, accountNo, bankInput] = exactMatch;
//         return await BeneficiaryService.save(
//           userId,
//           alias.trim(),
//           accountNo.trim(),
//           bankInput.trim()
//         );
//       }

//       // USER IS TRYING BUT WRONG FORMAT → HELP THEM
//       return (
//         "To save a beneficiary, reply exactly like this:\n\n" +
//         "• `save babe 0123456789 GTBank`\n" +
//         "• `save mom 0023456789 Access Bank`\n" +
//         "• `save dad 1100069532 9PSB`\n\n" +
//         "No test transfer needed — I save instantly!"
//       );
//     }

//     // LIST BENEFICIARIES
//     if (
//       lower.includes("beneficiar") ||
//       lower.includes("saved") ||
//       lower === "my people" ||
//       lower === "list"
//     ) {
//       return await BeneficiaryService.list(userId);
//     }

//     return null;
//   }
// }

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
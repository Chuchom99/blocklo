// import logger from "../config/logger.js";

// const INTENTS = {
//   balance: [/balance/i, /how much/i, /funds?/i, /wallet/i],
//   transfer: [/send/i, /transfer/i, /pay/i],
//   history: [/history/i, /transaction/i, /statement/i],
//   kyc: [/kyc/i, /verify/i, /bvn/i],
//   register: [/register/i, /sign up/i, /create account/i],
//   help: [/help/i, /menu/i, /options/i],
// };

// export class IntentService {
//   static detect(message) {
//     const lower = message.toLowerCase();

//     for (const [intent, patterns] of Object.entries(INTENTS)) {
//       if (patterns.some(p => p.test(lower))) {
//         logger.info(`[Intent] Detected: ${intent}`);
//         return { intent, confidence: 1.0 };
//       }
//     }

//     return { intent: "smalltalk", confidence: 0 };
//   }

//   static extractTransfer(message) {
//     const match = message.match(/(\d+(?:\.\d+)?)\s+to\s+(\d+)/i);
//     if (!match) return null;
//     return { amount: match[1], account: match[2] };
//   }
// }

// src/services/intent.service.js
import logger from "../config/logger.js";

export class IntentService {
  // === 1. Advanced Pattern Library ===
  static PATTERNS = {
    balance: {
      regex: [
        /how?\s*much\s*(?:dey|is)\s*(?:my|for)?\s*(?:acct|account|wallet|balance)/i,
        /check\s*(?:my)?\s*(?:acct|account|balance|funds?)/i,
        /balance|funds?|wallet\s*(?:dey|balance)/i,
        /wetin\s*(?:dey|remain)\s*(?:my|for)?\s*acct/i,
        /show\s*me\s*(?:my)?\s*balance/i,
        // NEW: Natural language
        /how\s*much\s*(?:do\s*i|have|i\s*have)\s*(?:in\s*(?:my)?\s*(?:acct|account|wallet))?/i,
      ],
    },
    transfer: {
      regex: [
        /send\s+([\d,]+(?:\.\d+)?)\s+(?:to|for)\s+(\d{10,})/i,
        /transfer\s+([\d,]+(?:\.\d+)?)\s+(?:to|for)\s+(\d{10,})/i,
        /pay\s+([\d,]+(?:\.\d+)?)\s+(?:to|for)\s+(\d{10,})/i,
        /move\s+([\d,]+(?:\.\d+)?)\s+(?:to|for)\s+(\d{10,})/i,
        /send\s+(\d+)\s*to\s*(\d+)/i,
        /wire\s+(\d+)\s*to\s*(\d+)/i,
        /dash\s*me\s*(\d+)\s*to\s*(\d+)/i,
      ],
      examples: [
        "send 500 to 0123456789",
        "transfer 1,000 to 1100068779",
        "dash me 200 to 08012345677",
      ],
    },
    history: {
      regex: [
        /show\s*(?:my)?\s*(?:history|transactions?|statement)/i,
        /recent\s*transactions?/i,
        /last\s*\d*\s*(?:transactions?|transfers?)/i,
        /wetin\s*i\s*(?:do|spend)\s*(?:yesterday|today)/i,
      ],
    },
    kyc: {
      regex: [
        /kyc|verify|bvn|nin|upgrade|level\s*2|tier\s*2/i,
        /complete\s*verification/i,
        /submit\s*bvn/i,
      ],
    },
    register: {
      regex: [
        /register|sign\s*up|create\s*account|open\s*acct/i,
        /start|join|new\s*user/i,
      ],
    },
    help: {
      regex: [/help|menu|commands?|what\s*can\s*you\s*do/i],
    },
  };

  // === 2. Detect Intent with Confidence ===
  static detect(message) {
    const lower = message.toLowerCase().replace(/[.,!?]/g, "");

    for (const [intent, config] of Object.entries(this.PATTERNS)) {
      for (const regex of config.regex) {
        const match = lower.match(regex);
        if (match) {
          const confidence = this._calculateConfidence(match, message);
          logger.info(
            `[Intent] ${intent} | confidence: ${confidence.toFixed(
              2
            )} | "${message}"`
          );
          return {
            intent,
            confidence,
            match: match[0],
            extracted:
              intent === "transfer" ? this._extractTransfer(match) : null,
          };
        }
      }
    }

    return { intent: "smalltalk", confidence: 0 };
  }

  // === 3. Smart Confidence Scoring ===
  static _calculateConfidence(match, original) {
    const matchedLength = match.length;
    const totalLength = original.length;
    const baseScore = matchedLength / totalLength;

    // Boost for exact phrases
    const exactPhrases = {
      balance: ["check balance", "my balance"],
      transfer: ["send to", "transfer to"],
    };
    const boosted = Object.entries(exactPhrases).some(([intent, phrases]) =>
      phrases.some((p) => original.toLowerCase().includes(p))
    );

    return boosted ? Math.min(baseScore * 1.5, 1.0) : baseScore;
  }

  // === 4. Extract Transfer Details ===
  static _extractTransfer(match) {
    const amountStr = match[1].replace(/,/g, "");
    const account = match[2];
    const amount = parseFloat(amountStr);

    if (isNaN(amount) || amount <= 0) return null;

    return {
      amount,
      account,
      formatted: amount.toLocaleString("en-NG", {
        style: "currency",
        currency: "NGN",
      }),
    };
  }

  // === 5. Fallback Suggestions ===
  static suggest(message) {
    const suggestions = [];
    if (/bal/i.test(message)) suggestions.push("check balance");
    if (/send|pay|trans/i.test(message))
      suggestions.push("send 500 to 0123456789");
    return suggestions.length > 0
      ? `Did you mean: ${suggestions.join(" or ")}?`
      : null;
  }
}

// Redaction helpers shared by the logger and the LLM conversation history.

const SENSITIVE_KEY = /pin|password|passcode|secret|token|authorization|bvn|nin|otp|cookie|apikey|api_key|private/i;

// Keep the last 4 digits of long digit runs (account numbers, phones, BVN/NIN).
const maskDigits = (text) => text.replace(/\d{10,}/g, (m) => `${"*".repeat(m.length - 4)}${m.slice(-4)}`);

export function redactText(text) {
  if (typeof text !== "string") return text;
  return maskDigits(
    text
      .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
      .replace(
        /("?(?:[a-z_]*pin|password|passcode|secret|token|authorization|bvn|nin|otp)[a-z_]*"?\s*[:=]\s*)("[^"]*"|[^\s,}]+)/gi,
        '$1"[REDACTED]"',
      ),
  );
}

export function redactObject(value, depth = 0) {
  if (depth > 6 || value == null) return value;
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((v) => redactObject(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redactText(value.message), stack: value.stack };
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[REDACTED]" : redactObject(v, depth + 1);
    }
    return out;
  }
  return value;
}

// A message that is only 4–6 digits is almost certainly a PIN or OTP typed into chat.
export const looksLikePin = (text) => /^\s*\d{4,6}\s*$/.test(text || "");

// Strip identity numbers before conversation text is stored or sent to the LLM.
export function redactForLlm(text) {
  if (typeof text !== "string") return text;
  return text.replace(/\b(bvn|nin)\b(\D{0,15})\d{11}\b/gi, "$1$2[REDACTED]");
}

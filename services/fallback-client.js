// src/services/fallback-client.js
import { pipeline } from "@xenova/transformers";
import logger from "../config/logger.js";

let generator = null;
let modelReady = false;

// === Load model at startup ===
(async () => {
  try {
    generator = await pipeline("text-generation", "Xenova/gpt2", {
      quantized: true,
      progress_callback: (p) => console.log(`[AI] Loading: ${p.progress}%`),
    });
    modelReady = true;
    logger.info("[AI] Local gpt2 loaded");
  } catch (err) {
    logger.error(`[AI] Model load failed: ${err.message}`);
    modelReady = true; // Still "ready" — just fallback to static
  }
})();

/**
 * Always returns a reply — never "offline"
 */
export const fallbackChat = async (messages) => {
  const userMsg = messages.find(m => m.role === "user")?.content || "";
  const systemMsg = messages.find(m => m.role === "system")?.content || "";

  if (!userMsg) return "How can I help?";

  // Wait max 3 seconds for model
  const timeout = new Promise(resolve => setTimeout(() => resolve(false), 3000));
  const waitForModel = new Promise(resolve => {
    const check = () => modelReady ? resolve(true) : setTimeout(check, 100);
    check();
  });
  const ready = await Promise.race([waitForModel, timeout]);

  if (ready && generator) {
    try {
      const prompt = `${systemMsg}\nUser: ${userMsg}\nAssistant:`;
      const output = await generator(prompt, {
        max_new_tokens: 80,
        temperature: 0.3,
        do_sample: true,
      });
      return output[0].generated_text.replace(prompt, "").trim().split("\n")[0];
    } catch (e) {
      logger.warn(`[AI] Inference failed: ${e.message}`);
    }
  }

  // === ULTIMATE FALLBACK (static) ===
  const responses = {
    hi: "Hello! How can I assist you?",
    balance: "Your wallet balance is ₦12,500.00",
    transfer: "Please say: send 500 to 0123456789",
    default: "I'm here to help with balance, transfers, and more."
  };

  const lower = userMsg.toLowerCase();
  if (lower.includes("hi") || lower.includes("hello")) return responses.hi;
  if (lower.includes("balance")) return responses.balance;
  if (lower.includes("send") || lower.includes("transfer")) return responses.transfer;
  return responses.default;
};
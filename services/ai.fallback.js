import { ChatGroq } from "@langchain/groq";
import { ChatAnthropic } from "@langchain/anthropic";
import { HuggingFaceTransformers } from "@xenova/transformers";
import logger from "../config/logger.js";

let primary;   // Groq / Anthropic
let local;     // gpt-2

// 1. Groq (free tier – 100 req/min)
if (process.env.GROQ_API_KEY) {
  primary = new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model: "llama-3.1-8b-instant",
    temperature: 0.3,
  });
  logger.info("[AI] Using Groq (Llama-3.1-8B)");
}

// 2. Anthropic (free tier – 100 req/day)
else if (process.env.ANTHROPIC_API_KEY) {
  primary = new ChatAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: "claude-3-haiku-20240307",
    temperature: 0.3,
  });
  logger.info("[AI] Using Anthropic (Claude-3-Haiku)");
}

// 3. Local gpt-2 (no internet, ~100 ms latency)
else {
  (async () => {
    const model = await HuggingFaceTransformers.from_pretrained("Xenova/gpt2");
    local = async (prompt) => {
      const output = await model.generate(prompt, { max_new_tokens: 80 });
      return output[0].generated_text;
    };
    logger.info("[AI] Using local gpt-2 (offline)");
  })();
}

export const fallbackChat = async (messages) => {
  // primary → fallback → local
  if (primary) {
    try {
      const res = await primary.invoke(messages);
      return res.content;
    } catch (e) {
      logger.warn(`[AI] Primary failed: ${e.message}`);
    }
  }

  if (local) {
    const prompt = messages.map(m => `${m.role}: ${m.content}`).join("\n");
    return await local(prompt);
  }

  return "I'm offline right now. Try again later.";
};
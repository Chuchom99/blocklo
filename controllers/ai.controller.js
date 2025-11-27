
import { langchainService } from "../services/ai.services.js";
import logger from "../config/logger.js";

export const processAIChat = async (req, res) => {
  try {
    const { from, message, profileName = "User" } = req.body;

    if (!from || !message) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: 'from' and 'message'",
      });
    }

    // This is EXACTLY what WhatsAppService does
    const normalizedFrom = from.toString().replace(/[^\d]/g, "").replace(/^234/, "234");

    // CRITICAL: Let the AI service do the user lookup (same as real flow)
    const userContext = await langchainService.getUserContext(normalizedFrom);

    // If user doesn't exist, simulate unregistered flow
    if (!userContext) {
      return res.status(200).json({
        success: true,
        data: {
          from: normalizedFrom,
          userMessage: message,
          aiResponse: `Hi ${profileName.split(" ")[0]}! Welcome to *Blocklo × 9PSB*\n\nYou haven't created your wallet yet.\n\nReply with *create account* to open your bank account in 60 seconds!`,
        },
      });
    }

    // Now process exactly like real WhatsApp messages
    const result = await langchainService.processAIChat(
      normalizedFrom,
      message.trim(),
      userContext
    );

    return res.status(200).json({
      success: true,
      data: {
        from: normalizedFrom,
        userMessage: message,
        aiResponse: result.text || result,
        userContext, // optional: for debugging
      },
    });
  } catch (error) {
    logger.error(`AI Controller Error: ${error.message}\nStack: ${error.stack}`);
    return res.status(500).json({
      success: false,
      message: "AI processing failed",
      error: error.message,
    });
  }
};
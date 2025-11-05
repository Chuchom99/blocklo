// import AIService from "../services/ai.services.js";

// class AiController {
//   static async chat(req, res) {
//     try {
//       const { userId, message } = req.body;

//       if (!userId || !message) {
//         return res.status(400).json({ success: false, message: "userId and message are required" });
//       }

//       const response = await AIService(userId, message);

//       return res.status(200).json({
//         success: true,
//         reply: response.reply,
//         history: response.history,
//       });
//     } catch (err) {
//       console.error("AI Conversation Error:", err.message);
//       return res.status(500).json({ success: false, message: "Failed to process AI request" });
//     }
//   }
// }

// export default AiController;

import { langchainService } from "../services/ai.services.js";
import logger from "../config/logger.js";

/**
 * @route   POST /api/ai/message
 * @desc    Process user message through AI (LangChain + 9PSB logic)
 * @body    { from, message, userId }
 */
export const processAiMessage = async (req, res) => {
  try {
    const { from, message, userId } = req.body;

    if (!from || !message) {
      return res
        .status(400)
        .json({ success: false, message: "Missing 'from' or 'message' field" });
    }

    const aiResponse = await langchainService.processMessage(from, message, userId);

    return res.status(200).json({
      success: true,
      message: "AI processed message successfully",
      data: {
        from,
        userId,
        userMessage: message,
        aiResponse,
      },
    });
  } catch (error) {
    logger.error(`AI Controller Error: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, message: "AI processing failed", error: error.message });
  }
};


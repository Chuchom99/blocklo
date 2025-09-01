import AIService from "../services/ai.services.js";

class AiController {
  static async chat(req, res) {
    try {
      const { userId, message } = req.body;

      if (!userId || !message) {
        return res.status(400).json({ success: false, message: "userId and message are required" });
      }

      const response = await AIService(userId, message);

      return res.status(200).json({
        success: true,
        reply: response.reply,
        history: response.history,
      });
    } catch (err) {
      console.error("AI Conversation Error:", err.message);
      return res.status(500).json({ success: false, message: "Failed to process AI request" });
    }
  }
}

export default AiController;

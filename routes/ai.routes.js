import express from "express";
import aiController from "../controllers/ai.controller.js"; 

const router = express.Router()

// AI Conversation
router.post('/chat', aiController.chat);

export default router;

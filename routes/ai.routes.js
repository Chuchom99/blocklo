import express from "express";
import { processAIChat } from "../controllers/ai.controller.js";

const router = express.Router();

router.post("/message", processAIChat);

export default router;

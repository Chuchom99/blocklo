import express from "express";
import { processAiMessage } from "../controllers/ai.controller.js";

const router = express.Router();

router.post("/message", processAiMessage);

export default router;
